// TaskListTab.tsx
import React from "react";
import { Box } from "@mui/joy";
import List from "@mui/joy/List";

import { type TaskState } from "@acme/agent";
import { type DraftExecutionEdge, type DraftExecutionNode } from "@acme/db";

import TaskListItem from "./TaskListItem";

type TaskListTabProps = {
  sortedTaskStates: TaskState[];
  nodes: DraftExecutionNode[];
  edges: DraftExecutionEdge[];
  statusColor: (
    n: TaskState,
  ) => "danger" | "success" | "warning" | "primary" | "neutral" | undefined;
  isRunning: boolean;
  taskListRef: React.RefObject<HTMLUListElement>;
  listItemsRef: React.MutableRefObject<HTMLLIElement[]>;
};

export const TaskListTab = ({
  sortedTaskStates,
  nodes,
  edges,
  statusColor,
  isRunning,
  taskListRef,
  listItemsRef,
}: TaskListTabProps) => {
  return (
    <List aria-label="Task list" size="sm" ref={taskListRef}>
      {sortedTaskStates.map((t, i) => (
        <Box
          key={t.id}
          sx={(theme) => ({
            backgroundColor:
              i % 2 === 1
                ? theme.palette.background.level2
                : theme.palette.background.level1,
            p: 0,
            mx: 0,
            mb: 2,
            mt: 0,
            pt: 2,
          })}
        >
          <TaskListItem
            task={t}
            nodes={nodes}
            edges={edges}
            i={i}
            statusColor={statusColor}
            listItemsRef={listItemsRef}
            isRunning={isRunning}
          />
        </Box>
      ))}
    </List>
  );
};

export default TaskListTab;
