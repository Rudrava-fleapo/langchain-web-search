import { z } from "zod";
import { StructuredTool } from "@langchain/core/tools";
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

class GoogleGroundingTool extends StructuredTool {
    name = "google_search_grounding";
    description = "A tool to generate a response for a query by directly grounding it with Google Search using Gemini. " +
        "Input should be the user's original query. " +
        "Prefer this for current events, factual questions, or when specific and up-to-date information is needed.";
    schema = z.object({
        query: z.string().describe("The user's original query to be answered with Google Search Grounding."),
    });

    constructor(apiKey, fields) {
        super(fields);
        if (!apiKey) {
            console.warn("Google API key is missing. GoogleGroundingTool will not function.");
            this.apiKey = null;
        } else {
            this.apiKey = apiKey;
            this.genAI = new GoogleGenerativeAI(apiKey);
        }
        this.modelName = 'gemini-2.5-pro';
        this.cache = {};
        this.cacheTTL = 5 * 60 * 1000;
    }

    async _call(input) {
        if (!this.apiKey || !this.genAI) {
            throw new Error("Google API key is not set. Cannot perform Google Grounding.");
        }

        const { query } = input;
        const cacheKey = `grounded_${query.toLowerCase()}`;

        const cachedResult = this.cache[cacheKey];
        if (cachedResult && (Date.now() - cachedResult.timestamp < this.cacheTTL)) {
            console.log(`[GoogleGroundingTool] Cache Hit for query: "${query}"`);
            return cachedResult.data; // Return content directly
        }

        console.log(`[GoogleGroundingTool] Calling Gemini Grounding for query: "${query}"`);
        try {
            const model = this.genAI.getGenerativeModel({
                model: this.modelName,
                tools: [{
                    googleSearch: {} // Enable Google Search tool
                }]
            });

            const result = await model.generateContent(query);
            const response = await result.response;
            const content = response.text();
            const citationMetadata = response.candidates?.[0]?.content?.parts?.[0]?.citationMetadata; // Raw citation metadata

            // Store content and raw citation metadata in tool's cache
            this.cache[cacheKey] = { data: content, timestamp: Date.now(), citations: citationMetadata };

            return content;
        } catch (error) {
            if (error instanceof GoogleGenerativeAIFetchError) {
                console.error(`[GoogleGroundingTool Error] for query "${query}": Google API Error:`, error.message);
                throw new Error(`Google Grounding failed: ${error.message}.`);
            }
            console.error(`[GoogleGroundingTool Error] for query "${query}":`, error);
            throw error;
        }
    }

    // Helper to parse citations from raw metadata (for external use, e.g., by the agent)
    _parseCitations(citationMetadata) {
        if (!citationMetadata || !citationMetadata.citationSources) {
            return [];
        }
        return citationMetadata.citationSources.map(source => ({
            url: source.uri,
            title: source.title || 'Untitled Source',
        }));
    }
}

export { GoogleGroundingTool };