import { z } from "zod";
import { StructuredTool } from "@langchain/core/tools";
import { PerplexitySearchAgent } from '../agents/searchAgent.js';

class PerplexitySearchTool extends StructuredTool {
    name = "perplexity_web_search";
    description = "A tool to search the web for up-to-date information using Perplexity. " +
        "Input should be a concise query string. " +
        "Useful for current events, statistics, or any information not in the LLM's training data.";
    schema = z.object({
        query: z.string().describe("The search query to send to Perplexity."),
    });

    constructor(apiKey, fields) {
        super(fields);
        this.perplexityAgent = new PerplexitySearchAgent(apiKey);
        this.cache = {}; // Simple in-memory cache for this tool's raw results
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    }

    async _call(input) {
        const { query } = input;
        const cacheKey = query.toLowerCase(); // Cache key for Perplexity tool's internal cache

        // This cache is specific to the tool's raw output.
        // The higher-level LangChainChatAgent manages its own cache for processed search results.
        const cachedResult = this.cache[cacheKey];
        if (cachedResult && (Date.now() - cachedResult.timestamp < this.cacheTTL)) {
            console.log(`[PerplexitySearchTool] Cache Hit for query: "${query}"`);
            return cachedResult.data.content;
        }

        console.log(`[PerplexitySearchTool] Calling Perplexity API for query: "${query}"`);
        try {
            const result = await this.perplexityAgent.searchWeb(query); // result is SearchResult object
            const outputContent = result.content;

            // Store the full SearchResult object in this tool's cache
            this.cache[cacheKey] = { data: result, timestamp: Date.now() };

            return outputContent;
        } catch (error) {
            console.error(`[PerplexitySearchTool Error] for query "${query}":`, error.message);
            throw new Error(`Failed to perform Perplexity search: ${error.message}`);
        }
    }
}

export { PerplexitySearchTool };