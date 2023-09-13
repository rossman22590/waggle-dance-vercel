// stores/waggleDanceStore.ts

import { v4 } from "uuid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { defaultAgentSettings, type AgentSettings } from "@acme/agent";
import {
  type DraftExecutionGraph,
  type Execution,
  type ExecutionPlusGraph,
  type GoalPlusExe,
} from "@acme/db";

import { app } from "~/constants";

export interface WaggleDanceMachineStore {
  isRunning: boolean;
  setIsRunning: (newState: boolean) => void;
  isAutoStartEnabled: boolean;
  setIsAutoStartEnabled: (newState: boolean) => void;
  agentSettings: Record<"plan" | "review" | "execute", AgentSettings>;
  setAgentSettings: (
    type: "plan" | "review" | "execute",
    newValue: Partial<AgentSettings>,
  ) => void;
  execution: ExecutionPlusGraph | null;
  setExecution: (newExecution: ExecutionPlusGraph | undefined | null) => void;
  graph: DraftExecutionGraph;
  setGraph: (newGraph: DraftExecutionGraph) => void;
}

export const draftExecutionPrefix = "draft-";
export const newDraftExecutionId = () => `${draftExecutionPrefix}${v4()}`;

export function createDraftExecution(selectedGoal: GoalPlusExe) {
  const executionId = newDraftExecutionId();
  const goalId = selectedGoal.id;
  const draftExecution: Execution = {
    id: executionId,
    goalId,
    userId: "guest",
    state: "EXECUTING",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return draftExecution;
}

const useWaggleDanceMachineStore = create(
  persist<WaggleDanceMachineStore>(
    (set, _get) => ({
      isRunning: false,
      setIsRunning: (newState) => set({ isRunning: newState }),
      isAutoStartEnabled: false,
      setIsAutoStartEnabled: (newState) =>
        set({ isAutoStartEnabled: newState }),
      agentSettings: defaultAgentSettings,
      setAgentSettings: (type, newValue) =>
        set((state) => ({
          agentSettings: {
            ...state.agentSettings,
            [type]: { ...state.agentSettings[type], ...newValue },
          },
        })),
      execution: null,
      setExecution: (newExecution) => {
        console.debug("setExecution", newExecution);
        // TODO: set graph to newExecution.graph if it is not null
        set((state) => ({
          execution: newExecution || null,
          graph: newExecution?.graph || state.graph,
        }));
      },
      graph: {
        nodes: [],
        edges: [],
        executionId: "",
      } as DraftExecutionGraph,
      setGraph: (graph) => {
        set((_state) => ({
          graph,
        }));
      },
    }),
    {
      name: app.localStorageKeys.waggleDance,
      storage: createJSONStorage(() => sessionStorage), // alternatively use: localStorage
      partialize: (state: WaggleDanceMachineStore) =>
        Object.fromEntries(
          Object.entries(state).filter(([key]) => !["isRunning"].includes(key)),
        ) as WaggleDanceMachineStore,
    },
  ),
);

export default useWaggleDanceMachineStore;
