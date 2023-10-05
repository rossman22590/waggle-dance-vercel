import { VectorDBQAChain } from "langchain/chains";
import { z } from "zod";

import { createModel } from "../..";
import { AgentPromptingMethod, LLM_ALIASES } from "../utils/llms";
import { vectorStoreFromIndex } from "../utils/vectorStore";
import DynamicZodSkill from "./DynamicZodSkill";

const schema = z.object({
  search: z
    .string()
    .nonempty()
    .describe("The text string to search for in the memory database"),
  namespace: z
    .string()
    .nonempty()
    .describe(
      "The namespace from which to retrieve the memory. Use the NAMESPACE variable for memory isolation. This improves security and prevents context poisoning.",
    ),
});

const retrieveMemorySkill = new DynamicZodSkill({
  name: "retrieveMemory",
  description: `You must use this tool at least once per task. When asked a question about contents of memory, this is useful for retrieving memories and entities from your memory palace.`,
  func: async (input, _runManager) => {
    const { search, namespace } = schema.parse(input);
    const vectorStore = await vectorStoreFromIndex(namespace);
    const ltmChain = VectorDBQAChain.fromLLM(
      createModel(
        { modelName: LLM_ALIASES["fast"], maxTokens: 300 },
        AgentPromptingMethod.OpenAIFunctions,
      ),
      vectorStore,
    );
    const result = await ltmChain.call({ query: search });
    return JSON.stringify(result); // Convert the result to a string
  },
  schema,
});

export default retrieveMemorySkill;
