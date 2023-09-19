import { type MutableRefObject } from "react";

import {
  initialNodes,
  TaskState,
  TaskStatus,
  type AgentPacket,
  type AgentSettingsMap,
} from "@acme/agent";
import { type DraftExecutionGraph, type DraftExecutionNode } from "@acme/db";

import executeTask from "../utils/executeTask";
import { isGoalReached } from "../utils/isGoalReached";
import planTasks from "../utils/planTasks";
import { sleep } from "../utils/sleep";
import {
  mapAgentSettingsToCreationProps,
  type GraphDataState,
  type WaggleDanceResult,
} from "./types";

type LogType = (...args: (string | number | object)[]) => void;
export type InjectAgentPacketType = (
  agentPacket: AgentPacket,
  node: DraftExecutionNode,
) => void;

export type RunParams = {
  goal: string;
  goalId: string;
  executionId: string;
  agentSettings: AgentSettingsMap;
  graphDataState: MutableRefObject<GraphDataState>;
  injectAgentPacket: InjectAgentPacketType;
  log: (...args: (string | number | object)[]) => void;
  abortController: AbortController;
};

class WaggleDanceAgentExecutor {
  private error: Error | null = null;
  private taskResults: Record<string, TaskState> = {};

  constructor(
    private agentSettings: AgentSettingsMap,
    private goal: string,
    private goalId: string,
    private executionId: string,
    private abortController: AbortController,
    private graphDataState: MutableRefObject<GraphDataState>,
    private injectAgentPacket: InjectAgentPacketType,
    private log: LogType,
  ) {}

  async run(): Promise<WaggleDanceResult | Error> {
    this.taskResults = {};
    this.error = null;
    const initialNode = initialNodes(this.goal)[0]!;
    void (async () => {
      try {
        const result = await this.planAndSetDAG();
        debugger;
        console.debug("done planning");
        if (!result || result.nodes.length === 1) {
          this.setError(new Error("No plan found"));
        }

        const donePacket: AgentPacket = {
          type: "done",
          value: `came up with a plan graph with ${
            result?.nodes.length ?? 0
          } tasks with ${result?.edges.length ?? 0} interdependencies`,
        };

        this.taskResults[initialNode.id] = new TaskState({
          ...initialNode,
          packets: [donePacket],
          value: donePacket,
          updatedAt: new Date(),
          nodeId: initialNode.id,
        });

        this.injectAgentPacket(donePacket, initialNode);
      } catch (error) {
        this.setError(error);
      }
    })();

    const scheduledTasks = new Set<string>();
    while (true) {
      const dag = this.graphDataState.current[0]; // Use the shared state to get the updated dag
      if (isGoalReached(dag, this.taskResults)) {
        console.debug("goal is reached");
        break;
      }
      if (this.error) {
        console.error("error", this.error);
        if (!this.abortController.signal.aborted) {
          this.abortController.abort();
        }
        break;
      }

      if (this.abortController.signal.aborted) {
        this.setError("Canceled");
        console.warn("aborted run");
        break;
      }

      // plan does not count as a pending task
      const pendingTasks = dag.nodes.filter(
        (node) => node.id != initialNode.id && !this.taskResults[node.id],
      );

      // Select tasks that have source edges that are all done or are dependent on the root node
      const pendingCurrentDagLayerTasks = pendingTasks.filter((task) => {
        if (scheduledTasks.has(task.id)) {
          return false;
        }
        const edgesLeadingToTask = dag.edges.filter(
          (edge) => edge.tId === task.id,
        );

        // Check if task is dependent on root node
        const isDependentOnRoot = edgesLeadingToTask.some(
          (edge) => edge.sId === initialNode.id,
        );

        // If task is dependent on root or all its source edges are done, select it
        return (
          isDependentOnRoot ||
          (edgesLeadingToTask.length > 0
            ? edgesLeadingToTask.every(
                (edge) =>
                  this.taskResults[edge.sId]?.status === TaskStatus.done,
              )
            : false)
        );
      });

      const isDonePlanning = this.taskResults[initialNode.id];

      if (pendingTasks.length === 0 && isDonePlanning) {
        // sanity check for invalid state
        throw new Error(
          "No pending tasks while we are not planning, yet the goal is not reached.",
        );
      } else {
        if (pendingCurrentDagLayerTasks.length === 0) {
          console.debug(
            "waiting for scheduled tasks (tasks without incomplete dependencies)",
          );
          await sleep(100);
        } else {
          this.executeTasks(pendingCurrentDagLayerTasks, dag, scheduledTasks);
        }
      }
    }

    return this.error || this.taskResults;
  }

  async planAndSetDAG(): Promise<DraftExecutionGraph | null> {
    const creationProps = mapAgentSettingsToCreationProps(
      this.agentSettings["plan"],
    );
    const fullPlanDAG = await planTasks({
      goal: this.goal,
      goalId: this.goalId,
      executionId: this.executionId,
      creationProps,
      graphDataState: this.graphDataState.current,
      log: this.log,
      injectAgentPacket: this.injectAgentPacket,
      abortSignal: this.abortController.signal,
    });

    if (fullPlanDAG) {
      this.graphDataState.current[1](fullPlanDAG, this.goal);
      return fullPlanDAG;
    }
    return null;
  }

  executeTasks(
    tasks: Array<DraftExecutionNode>,
    dag: DraftExecutionGraph,
    scheduledTasks: Set<string>,
  ) {
    const revieweeTaskResults = Object.values(this.taskResults);
    const startedTaskIds = new Set<string>();
    const tasksPromisesAndIds = tasks.map((task) => {
      if (!this.abortController.signal.aborted) {
        try {
          const creationProps = mapAgentSettingsToCreationProps(
            this.agentSettings["execute"],
          );
          const executeRequest = {
            goal: this.goal,
            goalId: this.goalId,
            executionId: this.executionId,
            agentPromptingMethod:
              this.agentSettings["execute"].agentPromptingMethod!,
            task,
            dag,
            revieweeTaskResults,
            creationProps,
          };
          scheduledTasks.add(task.id);
          return {
            id: task.id,
            promise: executeTask({
              request: executeRequest,
              injectAgentPacket: this.injectAgentPacket,
              log: this.log,
              abortSignal: this.abortController.signal,
            })
              .then((result) => this.injectAgentPacket(result, task))
              .catch((error) => this.setError(error)),
          };
        } catch (error) {
          this.setError(error);
        }
      } else {
        console.warn("aborted executeTasks");
      }
    });

    void Promise.all(tasksPromisesAndIds.map((t) => t?.promise));
    return startedTaskIds;
  }

  private setError(error: unknown) {
    this.error =
      error instanceof Error ? error : new Error(`Unknown error: ${error}`);
  }
}

export default WaggleDanceAgentExecutor;
