// agent/prompts/createPlanPrompt.ts

import { type StructuredTool } from "langchain/dist/tools/base";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  PromptTemplate,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { stringify as jsonStringify } from "superjson";
import { stringify as yamlStringify } from "yaml";

import { criticismSuffix } from "./types";

enum PolicyViolation {
  IGNORES_CONTEXT = "IGNORES_CONTEXT",
  INCORRECT_FINAL_NODE_NAME = "INCORRECT_FINAL_NODE_NAME",
  INCORRECT_DEPENDENCIES = "INCORRECT_DEPENDENCIES",
}

// FIXME: auto-gen this
export const schema = (format: string) =>
  `
  DAG = Level[] // top-level array of levels, level keys shall be numbers not strings
  Level = [key: string]: (Parents | Node)[]] // an array of mixed Parents and Nodes in this level
  Parents
    parents: string[] // an array of level ids that this level is dependent on
  Node
    id: string // e.g. "0", "1", "c" (the node id), unique within the Level.
    name: string // a title description of the Node. Must not contain invalid ${format} characters.
    context: string // Verbose expectations when done and parameters required to complete Task. Must not contain invalid ${format} characters.
It is extremely important to return only valid(⚠) ${format} representation of DAG, with levels as the keys.
`.trim();

const highQualityExamples = [
  {
    reason:
      "This example is designed to highlight the AI's ability to break down a complex task into smaller, manageable subtasks, and to perform these tasks in a logical and efficient order.",
    input:
      "Compare and contrast AgentGPT, AutoGPT, BabyAGI, https://waggledance.ai, and SuperAGI. Find similar projects or state of the art research papers. Create a .md (GFM) report of the findings.",
    output: {
      1: [
        {
          id: "0",
          name: "Research AgentGPT",
          context:
            "Investigate the features, capabilities, and limitations of AgentGPT.",
        },
        {
          id: "1",
          name: "Research AutoGPT",
          context:
            "Investigate the features, capabilities, and limitations of AutoGPT.",
        },
        {
          id: "2",
          name: "Research BabyAGI",
          context:
            "Investigate the features, capabilities, and limitations of BabyAGI.",
        },
        {
          id: "3",
          name: "Research SuperAGI",
          context:
            "Investigate the features, capabilities, and limitations of SuperAGI.",
        },
        {
          id: "4",
          name: "Explore Waggledance.ai",
          context:
            "Visit the website https://waggledance.ai and gather information about the project.",
        },
        {
          id: "c",
          name: "Review Research Findings",
          context:
            "Review the information gathered about the projects and identify key similarities and differences.",
        },
      ],
      2: [
        {
          parents: [1],
        },
        {
          id: "0",
          name: "Create Report Outline",
          context:
            "Create an outline for the report, including sections for each project and their comparisons.",
        },
        {
          id: "1",
          name: "Write Introduction",
          context:
            "Write an introduction for the report, providing an overview of the projects and their significance.",
        },
        {
          id: "2",
          name: "Write Project Descriptions",
          context:
            "Write detailed descriptions of each project, highlighting their key features and capabilities.",
        },
        {
          id: "3",
          name: "Compare and Contrast Projects",
          context:
            "Analyze the information gathered and identify similarities and differences between the projects.",
        },
        {
          id: "4",
          name: "Write Conclusion",
          context:
            "Summarize the findings and provide a conclusion on the compared projects.",
        },
        {
          id: "c",
          name: "Review Report Sections",
          context:
            "Review the sections for accuracy, clarity, and completeness.",
        },
      ],
      3: [
        {
          parents: [2],
        },
        {
          id: "0",
          name: "Merge and Format Document",
          context:
            "Merge all the written sections into a single document and format it using GitHub Flavored Markdown (GFM) syntax.",
        },
        {
          id: "c",
          name: "Review Final Report",
          context: "Review the report for accuracy, clarity, and completeness.",
        },
      ],
      4: [
        {
          parents: [3],
        },
        {
          id: "0",
          name: "🍯 Goal",
          context: "Deliver the final report to the User.",
        },
      ],
    },
  },
];

const counterExamples = [
  {
    input: "Translate the novel 'War and Peace' from Russian to English.",
    output: {
      1: [
        {
          id: "0",
          name: "📚 Obtain Russian version of 'War and Peace'",
          context: "Obtain the Russian version of the novel 'War and Peace'",
        },
      ],
      2: [
        {
          parents: ["0"],
          id: "1",
          name: "🔀 Translate each sentence independently",
          context:
            "Translate each sentence of the novel independently from Russian to English",
        },
      ],
      3: [
        {
          parents: ["1"],
          id: "2",
          name: "📖 Compile translated sentences into a book",
          context:
            "Compile all the translated sentences back into a book format",
        },
      ],
      4: [
        {
          parents: ["2"],
          id: "3",
          name: "🍯 Goal",
          context: "Deliver the translated version of 'War and Peace'",
        },
      ],
    },
    policyViolation: PolicyViolation.IGNORES_CONTEXT,
    reason:
      "Translating each sentence independently ignores the context provided by surrounding sentences. This can lead to incorrect translations, as the meaning of a sentence can often depend on its context. A better approach would be to translate larger sections of text that capture complete thoughts or ideas.",
  },
  {
    input: "Write a blog post about the history of programming languages.",
    output: {
      1: [
        {
          id: "0",
          name: "📚 Research the history of programming languages",
          context:
            "Gather information about the history of programming languages",
        },
        {
          id: "1",
          name: "📝 Write the introduction",
          context: "Write the introduction of the blog post",
        },
      ],
      2: [
        {
          parents: ["0"],
          id: "2",
          name: "📝 Write the main content",
          context:
            "Write the main content of the blog post based on the research",
        },
        {
          parents: ["1", "2"],
          id: "3",
          name: "📝 Write the conclusion",
          context: "Write the conclusion of the blog post",
        },
      ],
      3: [
        {
          parents: ["3"],
          id: "4",
          name: "📝 Finalize the blog post",
          context: "Finalize the blog post and prepare it for publishing",
        },
      ],
    },
    policyViolation: PolicyViolation.INCORRECT_FINAL_NODE_NAME,
    reason:
      "The name of the last node should be '🍯 Goal' to indicate that the Goal has been satisfactorily completed. In this case, the last node is named '📝 Finalize the blog post', which does not follow the prompt's instructions.",
  },
  {
    input: "Bake a chocolate cake and deliver it to a friend's house.",
    output: {
      1: [
        {
          id: "0",
          name: "🏠 Go to friend's house",
          context: "Go to the friend's house to know the location",
        },
        {
          id: "1",
          name: "🍫 Buy chocolate",
          context: "Buy the chocolate needed for the cake",
        },
      ],
      2: [
        {
          parents: ["0"],
          id: "2",
          name: "🍰 Bake the cake",
          context: "Bake the chocolate cake",
        },
        {
          parents: ["2"],
          id: "3",
          name: "🎁 Deliver the cake",
          context: "Deliver the cake to the friend's house",
        },
      ],
      3: [
        {
          parents: ["3"],
          id: "4",
          name: "🍯 Goal",
          context: "Confirm that the cake has been delivered",
        },
      ],
    },
    policyViolation: PolicyViolation.INCORRECT_DEPENDENCIES,
    reason:
      "The Task 'Bake the cake' is not logically dependent on 'Go to friend's house'. The correct order should be 'Buy chocolate', 'Bake the cake', 'Go to friend's house', and then 'Deliver the cake'. This example demonstrates a plan where a node is not logically dependent on its parent.",
  },
];

const constraints = (format: string) =>
  `
# General
- If the Goal is phrased like a question or chat comment that can be confidently satisfied by responding with a single answer, then the only node should be "🍯 Goal".
- Escape all special characters such as quotation marks, curly braces, colons, etc, according to ${format} rules.
- The only thing you must output is valid ${format} that represents the DAG as the root object.

# DAG Construction
- The DAG shall be constructed in a way such that its parallelism is maximized (siblings maximized, levels minimized.)
- Sibling nodes within each level can be run in parallel since they will not logically depend on one another, except the criticism node.
- All levels must eventually lead to a "🍯 Goal" Task which, after executing, ensures that the Goal has been satisfactorily completed.
- For every level in the DAG, include a single node with id "${criticismSuffix}". It will run after all other nodes in the level have been executed.

# Context Isolation
- Node context must be self-contained and sufficient to complete the Task according to the Goal.
`.trim();

export function createPlanPrompt(params: {
  goalPrompt: string;
  goalId: string;
  tools: StructuredTool[];
  returnType: "JSON" | "YAML";
}): ChatPromptTemplate {
  const { goalPrompt, tools, returnType } = params;
  const toolNames = tools.map((tool) => tool.name).join(",");

  const highQualityExamplesWithCounterExample = {
    Examples: highQualityExamples,
    "Counter-examples:": counterExamples,
  };

  const template = `
# You are a general Goal-solving AI employed by the User to solve the User's Goal.
- Team Tools: [${toolNames}]
- Goal: ${goalPrompt}
- Current Time: ${new Date().toString()}
- Schema: ${schema(returnType)}
- Constraints: ${constraints(returnType)}
- Examples:

  ${
    returnType === "JSON"
      ? jsonStringify(highQualityExamplesWithCounterExample)
      : yamlStringify(highQualityExamplesWithCounterExample)
  }

# Task: To come up with an efficient and expert plan to solve the User's Goal, according to the schema.
Thank you so much!
- User ❤️
`.trimEnd();

  const systemMessagePrompt =
    SystemMessagePromptTemplate.fromTemplate(template);

  const humanTemplate = `My Goal is: ${goalPrompt}`;
  const humanMessagePrompt =
    HumanMessagePromptTemplate.fromTemplate(humanTemplate);

  const chatPrompt = ChatPromptTemplate.fromPromptMessages([
    systemMessagePrompt,
    humanMessagePrompt,
  ]);

  return chatPrompt;
}

export function createPlanFormattingPrompt(
  input: string,
  output: string,
  returnType: "JSON" | "YAML",
): PromptTemplate {
  const template = `TASK: You are to REWRITE only the OUTPUT of a large language model for a given INPUT, ensuring that it is valid ${returnType}, validates for the SCHEMA, and adequately addresses the INPUT.
  SCHEMA: ${schema(returnType)}
  CONSTRAINT: **DO NOT** output anything other than the ${returnType}, e.g., do not include prose or markdown formatting.
  INPUT:
  ${input}
  OUTPUT:
  ${output}
  REWRITE:
  `;
  return PromptTemplate.fromTemplate(template);
}
