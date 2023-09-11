// WaggleDanceMachine.ts

// INTENDED BEHAVIOR:
// This machine is intended to plan and execute tasks concurrently, ensuring goal completion as quickly as possible.
// It starts by generating an execution DAG and then executes the tasks concurrently.
// When a task completes, a new dependent review task should be added to the DAG to ensure quality results.

import { stringify } from "yaml";

import {
  type AgentPacket,
  type AgentSettingsMap,
  type TaskState,
} from "../../../../../packages/agent";
import { initialNodes, rootPlanId } from "./types/initialNodes";
import TaskExecutor, { type InjectAgentPacketType } from "./types/TaskExecutor";
import {
  mapAgentSettingsToCreationProps,
  type ExecuteRequestBody,
  type GraphDataState,
  type IsDonePlanningState,
  type WaggleDanceResult,
} from "./types/types";
import executeTask from "./utils/executeTask";
import { isGoalReached } from "./utils/isGoalReached";
import planTasks from "./utils/planTasks";
import { sleep } from "./utils/sleep";

export type RunParams = {
  goal: string;
  goalId: string;
  executionId: string;
  agentSettings: AgentSettingsMap;
  graphDataState: GraphDataState;
  isDonePlanningState: IsDonePlanningState;
  injectAgentPacket: InjectAgentPacketType;
  log: (...args: (string | number | object)[]) => void;
  abortController: AbortController;
};

// The main class for the WaggleDanceMachine that coordinates the planning and execution of tasks
export default class WaggleDanceMachine {
  constructor() {
    console.debug("WaggleDanceMachine.constructor");
  }
  async run({
    goal,
    goalId,
    executionId,
    agentSettings,
    graphDataState: [dag, setDAG],
    isDonePlanningState: [isDonePlanning, setIsDonePlanning],
    injectAgentPacket: injectAgentPacket,
    log,
    abortController,
  }: RunParams): Promise<WaggleDanceResult | Error> {
    const initNodes = initialNodes(goal);

    const completedTasks: Set<string> = new Set([rootPlanId]);

    let resolveFirstTask: () => void = () => {}; // these are just placeholders, overwritten within firstTaskPromise
    let rejectFirstTask: () => void = () => {}; // these are just placeholders, overwritten within firstTaskPromise

    const firstTaskPromise = new Promise<void>((resolve, reject) => {
      resolveFirstTask = resolve;
      rejectFirstTask = reject;
    });

    const taskExecutor = new TaskExecutor(
      agentSettings,
      goal,
      goalId,
      executionId,
      completedTasks,
      abortController,
      injectAgentPacket,
      log,
      resolveFirstTask,
      rejectFirstTask,
    );

    if (dag.edges.length > 1 && isDonePlanning) {
      log("skipping planning because it is done - dag", dag);
    } else {
      setIsDonePlanning(false);
      try {
        const creationProps = mapAgentSettingsToCreationProps(
          agentSettings["plan"],
        );

        dag = await planTasks({
          goal,
          goalId,
          executionId,
          creationProps,
          graphDataState: [dag, setDAG],
          log,
          injectAgentPacket,
          startFirstTask: taskExecutor.startFirstTask.bind(taskExecutor),
          abortSignal: abortController.signal,
        });
        setDAG(dag);
        console.debug("dag", dag);
      } catch (error) {
        if (initNodes[0]) {
          injectAgentPacket(
            {
              type: "error",
              severity: "fatal",
              error: error as Error,
            },
            initNodes[0],
          );
          return error as Error;
        } else {
          throw new Error("no initial node");
        }
      }

      if (dag && initNodes[0]) {
        if (dag.nodes.length < 2) {
          injectAgentPacket(
            {
              type: "error",
              severity: "fatal",
              error: new Error(
                "No tasks planned, this is likely due to another uncaught error",
              ),
            },
            initNodes[0],
          );
        } else if (dag.edges.length < 1) {
          injectAgentPacket(
            {
              type: "error",
              severity: "fatal",
              error: new Error(
                "No edges planned, this is likely due to another uncaught error",
              ),
            },
            initNodes[0],
          );
        }
        injectAgentPacket(
          {
            type: "done",
            value: `Planned an execution graph with ${dag.nodes.length} tasks and ${dag.edges.length} edges.`,
          },
          initNodes[0],
        );
        setIsDonePlanning(true);
      } else {
        throw new Error("either no dag or no initial node");
      }

      log("done planning");
    }
    // prepend our initial nodes to the DAG

    const toDoNodes = Array.from(dag.nodes);
    const taskResults: Record<string, TaskState> = {};
    await firstTaskPromise;
    // Continue executing tasks and updating DAG until the goal is reached
    while (!isGoalReached(dag, completedTasks)) {
      if (abortController.signal.aborted) throw new Error("Signal aborted");

      // console.group("WaggleDanceMachine.run")
      const pendingTasks = toDoNodes.filter(
        (node) => !completedTasks.has(node.id),
      );

      if (pendingTasks.length === 0) {
        await sleep(1000); // FIXME: observation model instead
        continue;
      }

      const pendingCurrentDagLayerTasks = pendingTasks.filter((task) =>
        dag.edges
          .filter((edge) => edge.tId === task.id)
          .every((edge) => completedTasks.has(edge.sId)),
      );

      if (pendingCurrentDagLayerTasks.length === 0) {
        if (pendingTasks.length === 0 && toDoNodes.length === 0) {
          throw new Error(
            "No pending tasks, and no executable tasks, but goal not reached.",
          );
        }
      }
      if (pendingCurrentDagLayerTasks.length > 0) {
        log(
          "relevantPendingTasks",
          pendingCurrentDagLayerTasks.map((task) => task.name),
        );
      }

      const task = pendingCurrentDagLayerTasks.splice(0, 1)[0]; // pop first task
      if (!task) {
        await sleep(100); // wait for tasks to end
        continue;
      }
      toDoNodes.splice(toDoNodes.indexOf(task), 1); // remove from toDoNodes

      const creationProps = mapAgentSettingsToCreationProps(
        agentSettings["execute"],
      );

      const idMinusSuffix = task.id.split("-")[0];
      const revieweeTaskResults = Object.entries(taskResults)
        .filter((task) => task[0].startsWith(idMinusSuffix + "-"))
        .map((task) => task[1]);
      // const revieweeTaskResults = dag.edges.filter(
      //   (edge) => edge.tId === task.id,
      // );
      const executeRequest = {
        goal,
        goalId,
        executionId,
        agentPromptingMethod: agentSettings["execute"].agentPromptingMethod!,
        task,
        dag,
        revieweeTaskResults,
        completedTasks,
        creationProps,
      } as ExecuteRequestBody;

      void (async () => {
        let result: AgentPacket | undefined | null;
        try {
          result = await executeTask({
            request: executeRequest,
            injectAgentPacket,
            log,
            abortSignal: abortController.signal,
          });
          injectAgentPacket(result, task);
        } catch (e) {
          const error = e instanceof Error ? e : new Error(stringify(e));
          injectAgentPacket(
            {
              type: "error",
              severity: "fatal",
              error,
            },
            task,
          );
          abortController.abort();
          return;
        }
        completedTasks.add(executeRequest.task.id);
      })();
    }

    console.debug("WaggleDanceMachine.run: completedTasks", completedTasks);
    console.groupEnd();

    return { taskResults, completedTasks };
  }
}
