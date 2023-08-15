// useWaggleDanceMachine.ts

import { useCallback, useEffect, useMemo, useState } from "react";
import { stringify } from "yaml";

import { type Execution } from "@acme/db";

import { type GoalPlusExe } from "~/stores/goalStore";
import useWaggleDanceMachineStore from "~/stores/waggleDanceStore";
import { type ChainPacket } from "../../../../../../packages/agent";
import { type GraphData } from "../components/ForceGraph";
import DAG, { type DAGNode, type DAGNodeClass } from "../DAG";
import { type WaggleDanceResult } from "../types";
import { dagToGraphData } from "../utils/conversions";
import WaggleDanceMachine, {
  initialEdges,
  initialNodes,
} from "../WaggleDanceMachine";

interface UseWaggleDanceMachineProps {
  goal: GoalPlusExe | undefined;
}

export type LogMessage = {
  message: string;
  type: "info" | "error";
  timestamp: Date;
};

export enum TaskStatus {
  idle = "idle",
  starting = "starting",
  working = "working",
  done = "done",
  wait = "wait", // for human?
  error = "error",
}

export type TaskState = DAGNode & {
  status: TaskStatus;
  fromPacketType: ChainPacket["type"] | null;
  result: string | null;
  packets: ChainPacket[];
  updatedAt: Date;
};

const useWaggleDanceMachine = ({ goal }: UseWaggleDanceMachineProps) => {
  const [waggleDanceMachine] = useState(new WaggleDanceMachine());
  const { setIsRunning, agentSettings } = useWaggleDanceMachineStore();
  const graph = goal?.executions.find((e) => {
    const dag = e.graph as DAG | null;
    return dag !== null && dag.nodes?.length > 0;
  })?.graph as DAG | null;
  const results = useMemo(() => {
    return goal?.results?.map((r) => {
      return {
        status: "done",
        result: r.value,
        packets: [] as ChainPacket[],
      } as TaskState;
    });
  }, [goal?.results]);
  // map results to Record<string, TaskState>
  // correct Typescript:
  const resultsMap = useMemo(
    () =>
      results?.reduce(
        (acc: Record<string, TaskState>, cur: TaskState) => {
          return { ...acc, [cur.id]: cur };
        },
        {} as Record<string, TaskState>,
      ),
    [results],
  );
  const [dag, setDAG] = useState<DAG>(graph ?? new DAG([], []));
  const [isDonePlanning, setIsDonePlanning] = useState(false);
  const [taskResults, setTaskResults] = useState<Record<string, TaskState>>(
    resultsMap ?? {},
  );
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [chainPackets, setChainPackets] = useState<Record<string, TaskState>>(
    {},
  );
  const [abortController, setAbortController] = useState<AbortController>(
    new AbortController(),
  );

  // takes a ChainPacket type and maps it to an appropriate TaskStatus, or idle if it does not match or is undefined
  const mapPacketTypeToStatus = (
    packetType: ChainPacket["type"] | undefined,
  ): TaskStatus => {
    switch (packetType) {
      case "token":
      case "handleLLMStart":
      case "handleChainStart":
      case "handleToolStart":
      case "handleAgentAction":
        return TaskStatus.working;
      case "done":
      case "handleAgentEnd":
        return TaskStatus.done;
      case "error":
      case "handleLLMError":
      case "handleChainError":
      case "handleToolError":
        return TaskStatus.error;
      case "working":
        return TaskStatus.working;
      case "requestHumanInput":
        return TaskStatus.wait;
      default:
        return TaskStatus.idle;
    }
  };

  const log = useCallback(
    (...args: (string | number | object)[]) => {
      const message = args
        .map((arg) => {
          if (typeof arg === "string") {
            return arg;
          } else {
            return stringify(arg);
          }
        })
        .join(", ");

      setLogs((prevLogs) => [
        ...prevLogs,
        { message, type: "info", timestamp: new Date() },
      ]);

      // Log to the console (optional)
      console.log(message);
    },
    [setLogs],
  );

  const taskStates = useMemo(() => {
    const reduceTaskStates = (
      dagNodes: DAGNode[],
      chainPackets: Record<string, TaskState>,
    ): TaskState[] => {
      return dagNodes.map((node) => {
        const chainPacket = chainPackets[node.id];
        const packets = chainPacket?.packets ?? [];
        const status = mapPacketTypeToStatus(packets[packets.length - 1]?.type);
        const result = chainPacket?.result ?? null;

        // Get the existing task state
        const existingTaskState = taskResults[node.id];

        // If the task state is not changed, return the existing state
        if (
          existingTaskState &&
          existingTaskState.status === status &&
          existingTaskState.result === result &&
          existingTaskState.packets.length === packets.length
        ) {
          return existingTaskState;
        }

        // Otherwise, return a new state with updated 'updatedAt'
        return {
          ...node,
          status,
          result,
          fromPacketType: packets[packets.length - 1]?.type ?? null,
          updatedAt: new Date(),
          packets,
        };
      });
    };
    const taskStates = reduceTaskStates(dag.nodes, chainPackets);
    return taskStates;
  }, [chainPackets, dag.nodes, taskResults]);
  const sendChainPacket = useCallback(
    (chainPacket: ChainPacket, node: DAGNode | DAGNodeClass) => {
      if (!node || !node.id) {
        throw new Error("a node does not exist to receive data");
      }
      const existingTask = chainPackets[node.id];
      if (!existingTask) {
        if (!node) {
          log(
            `Warning: node not found in the dag during chain packet update: ${chainPacket.type}`,
          );
          return;
        } else {
          setChainPackets((prevChainPackets) => ({
            ...prevChainPackets,
            [node.id]: {
              ...node,
              status: TaskStatus.idle,
              fromPacketType: null,
              result:
                chainPacket.type === "done"
                  ? chainPacket.value
                  : chainPacket.type === "error"
                  ? chainPacket.message
                  : null,
              packets: [chainPacket],
              updatedAt: new Date(),
            },
          }));
        }
      } else {
        const updatedTask = {
          ...existingTask,
          status: mapPacketTypeToStatus(chainPacket.type),
          fromPacketType: chainPacket.type,
          result:
            chainPacket.type === "done"
              ? chainPacket.value
              : chainPacket.type === "error"
              ? chainPacket.message
              : null,
          packets: [...existingTask.packets, chainPacket],
          updatedAt: new Date(),
        } as TaskState;
        setChainPackets((prevChainPackets) => ({
          ...prevChainPackets,
          [node.id]: updatedTask,
        }));
      }
    },
    [chainPackets, setChainPackets, log],
  );

  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });

  useEffect(() => {
    setGraphData(dagToGraphData(dag, taskStates));
  }, [dag, taskStates, setGraphData]);

  const stop = useCallback(() => {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  }, [abortController]);

  // main entrypoint
  const run = useCallback(
    async (execution: Execution) => {
      const ac = new AbortController();
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
      setAbortController(ac);

      setIsDonePlanning(false);
      setChainPackets({});
      setTaskResults({});
      setDAG(new DAG(initialNodes(goal?.prompt ?? ""), initialEdges()));

      const prompt = goal?.prompt;
      if (!prompt) {
        throw new Error("Prompt not set");
      }

      const goalId = goal?.id;
      if (!prompt || !goalId) {
        throw new Error("Goal not set");
      }

      const executionId = execution?.id;
      if (!executionId) {
        throw new Error("Execution not set");
      }

      let result: WaggleDanceResult | Error;
      try {
        result = await waggleDanceMachine.run({
          goal: prompt,
          goalId,
          executionId,
          agentSettings,
          graphDataState: [dag, setDAG],
          isDonePlanningState: [isDonePlanning, setIsDonePlanning],
          sendChainPacket,
          log,
          abortController: ac,
        });
      } catch (error) {
        if (error instanceof Error) {
          result = error;
        } else {
          result = new Error(`Unknown error ${JSON.stringify(error)}`);
        }
      }

      console.log("waggleDanceMachine.run result", result);

      setIsRunning(false);
      if (!ac.signal.aborted) {
        ac.abort();
      }

      if (result instanceof Error) {
        console.error("Error in WaggleDanceMachine's run:", result);
        return;
      } else {
        console.log("result", result);
        const res = result.results[0] as Record<string, TaskState>;
        res && setTaskResults(res);
        return result;
      }
    },
    [
      abortController,
      isDonePlanning,
      goal?.prompt,
      goal?.id,
      setIsRunning,
      waggleDanceMachine,
      agentSettings,
      dag,
      sendChainPacket,
      log,
    ],
  );

  return {
    waggleDanceMachine,
    dag,
    graphData,
    stop,
    run,
    setIsDonePlanning,
    isDonePlanning,
    logs,
    taskStates,
    taskResults,
  };
};

export default useWaggleDanceMachine;
