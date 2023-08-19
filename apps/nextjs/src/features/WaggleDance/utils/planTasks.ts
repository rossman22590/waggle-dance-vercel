// features/WaggleDance/utils/planTasks.ts

import {
  type ChainPacket,
  type ModelCreationProps,
} from "../../../../../../packages/agent";
import type DAG from "../DAG";
import { type DAGNode, type DAGNodeClass } from "../DAG";
import { initialNodes, rootPlanId } from "../initialNodes";
import { sleep } from "./sleep";

export type PlanTasksProps = {
  goal: string;
  goalId: string;
  executionId: string;
  creationProps: ModelCreationProps;
  graphDataState: [DAG, (dag: DAG) => void];
  log: (...args: (string | number | object)[]) => void;
  sendChainPacket: (
    chainPacket: ChainPacket,
    node: DAGNode | DAGNodeClass,
  ) => void;
  abortSignal: AbortSignal;
  startFirstTask?: (task: DAGNode, dag: DAG) => Promise<void>;
};

export default async function planTasks({
  goal,
  goalId,
  executionId,
  creationProps,
  graphDataState: [_initDag, setDAG],
  log,
  sendChainPacket,
  startFirstTask,
  abortSignal,
}: PlanTasksProps): Promise<DAG> {
  let hasFirstTaskStarted = false;
  const data = { goal, goalId, executionId, creationProps };
  const res = await fetch("/api/agent/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: abortSignal,
  });

  if (!res.ok) {
    console.error(`Error fetching plan: ${res.status} ${res.statusText}`);
    throw new Error(`Error fetching plan: ${res.status} ${res.statusText}`);
  }
  const stream = res.body;
  let initialNode: DAGNode | DAGNodeClass | undefined;
  if (!stream) {
    throw new Error(`No stream: ${res.statusText} `);
  } else {
    log(`started planning!`);
    initialNode = initialNodes(goal)[0];
    if (initialNode) {
      sendChainPacket({ type: "working", nodeId: rootPlanId }, initialNode);
    } else {
      log({ type: "error", nodeId: rootPlanId, message: "No initial node" });
      throw new Error("No initial node");
    }
  }

  let postMessageCount = 0;
  let dag: DAG | null | undefined;
  const parseWorker = new Worker(new URL("./parseWorker.ts", import.meta.url));

  parseWorker.onerror = function (event) {
    console.error("parseWorker error", event);
    postMessageCount--;
  };
  parseWorker.onmessageerror = function (event) {
    console.error("parseWorker onmessageerror", event);
    postMessageCount--;
  };
  parseWorker.onmessage = function (
    event: MessageEvent<{
      dag: DAG | null | undefined;
      error: Error | undefined;
    }>,
  ) {
    postMessageCount--;
    const { dag: newDag, error } = event.data;

    if (!!error) {
      return;
    }

    if (newDag) {
      const diffNodesCount = newDag.nodes.length - (dag?.nodes.length ?? 0);
      const newEdgesCount = newDag.edges.length - (dag?.edges.length ?? 0);
      if (diffNodesCount || newEdgesCount) {
        setDAG(newDag);
        dag = newDag;
      }

      const firstNode = newDag.nodes[1];
      if (
        !hasFirstTaskStarted &&
        startFirstTask &&
        firstNode &&
        newDag.nodes.length > 0
      ) {
        hasFirstTaskStarted = true;
        console.log("starting first task", firstNode.id);
        void startFirstTask(firstNode, newDag);
      }
    }
  };

  let buffer = Buffer.alloc(0);
  async function streamToString(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    const transformStream = new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        controller.enqueue(decoder.decode(chunk));
      },
    });

    const readableStream = stream.pipeThrough(transformStream);
    const reader = readableStream.getReader();

    let result;
    while ((result = await reader.read()) && !result.done) {
      if (abortSignal.aborted) {
        throw new Error("Signal aborted");
      }
      const newData = Buffer.from(result.value);
      const lineBreakIndex = newData.lastIndexOf("\n");

      if (lineBreakIndex !== -1) {
        const completeLine = newData.subarray(0, lineBreakIndex + 1);
        const partialLine = newData.subarray(lineBreakIndex + 1);

        buffer = Buffer.concat([buffer, completeLine]);
        postMessageCount++;
        parseWorker.postMessage({ buffer: buffer.toString(), goal });
        buffer = partialLine;
      } else {
        buffer = Buffer.concat([buffer, newData]);
      }
    }
    while (postMessageCount > 0) {
      await sleep(10);
    }
  }

  await streamToString(stream);
  if (!dag) {
    throw new Error("No planTasks result");
  }
  return dag;
}
