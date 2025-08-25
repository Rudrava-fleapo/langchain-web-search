import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { PerplexitySearchTool } from "../tools/PerplexitySearchTool.js";
import { GoogleGroundingTool } from "../tools/GoogleGroundingTool.js";

const RAG_PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
    ["system",
        "You are a helpful AI assistant. Answer the user's questions truthfully and informatively based on the provided search context." +
        "Cite your sources from the context clearly using numbers like [1], [2] next to the relevant information." +
        "If the search context does not contain enough information to answer the question, state that you don't know." +
        "Search Context:\n\n{search_context}\n\n"
    ],
    ["human", "{user_input}"]
]);

const ERROR_FALLBACK_PROMPT = ChatPromptTemplate.fromMessages([
    ["system", "You are an AI assistant. Explain politely that an error occurred."],
    ["human", "I'm very sorry, but I encountered an internal error while processing your request. Please try again or rephrase your question. (Original user query: {original_query})"]
]);

class LangChainChatAgent {
    constructor(apiKeys) {
        this.apiKeys = apiKeys;
        this.models = {};
        this.tools = {};
        this._initializeModels();
        this._initializeTools();
        this.searchCache = {};
        this.searchCacheTTL = 5 * 60 * 1000;
    }

    _initializeModels() {
        console.log("[LangChainChatAgent] Initializing models...");
        if (this.apiKeys.openai) {
            this.models.openai_capable = new ChatOpenAI({ apiKey: this.apiKeys.openai, model: "gpt-4-turbo", temperature: 0.2, streaming: true });
            this.models.openai_fast = new ChatOpenAI({ apiKey: this.apiKeys.openai, model: "gpt-3.5-turbo", temperature: 0.7, streaming: true });
            console.log("  OpenAI models initialized.");
        } else { console.warn("OpenAI API key missing. OpenAI models will not be available."); }

        if (this.apiKeys.google) {
            this.models.google_capable = new ChatGoogleGenerativeAI({ apiKey: this.apiKeys.google, model: "gemini-2.5-pro", temperature: 0.2, streaming: true });
            this.models.google_fast = new ChatGoogleGenerativeAI({ apiKey: this.apiKeys.google, model: "gemini-2.5-pro", temperature: 0.7, streaming: true });
            console.log("  Google Gemini models initialized.");
        } else { console.warn("Google API key missing. Google Gemini models will not be available."); }

        if (this.apiKeys.anthropic) {
            this.models.anthropic_capable = new ChatAnthropic({ apiKey: this.apiKeys.anthropic, model: "claude-3-sonnet-20240229", temperature: 0.2, streaming: true });
            this.models.anthropic_fast = new ChatAnthropic({ apiKey: this.apiKeys.anthropic, model: "claude-3-haiku-20240307", temperature: 0.7, streaming: true });
            console.log("  Anthropic Claude models initialized.");
        } else { console.warn("Anthropic API key missing. Anthropic models will not be available."); }
    }

    _initializeTools() {
        console.log("[LangChainChatAgent] Initializing tools...");
        if (this.apiKeys.perplexity) {
            this.tools.perplexity_web_search = new PerplexitySearchTool(this.apiKeys.perplexity);
            console.log("  PerplexitySearchTool initialized.");
        } else { console.warn("Perplexity API key missing. Perplexity search will not be available."); }

        if (this.apiKeys.google) {
            this.tools.google_search_grounding = new GoogleGroundingTool(this.apiKeys.google);
            console.log("  GoogleGroundingTool initialized.");
        } else { console.warn("Google API key missing. Google Grounding will not be available."); }
    }

    _getLLM(modelProvider, modelName) {
        if (!this.models[modelProvider + '_capable'] && !this.models[modelProvider + '_fast']) {
            return null; // Provider not initialized
        }
        if (modelName.includes("fast")) {
            return this.models[`${modelProvider}_fast`];
        }
        // Handle explicit modelName overrides
        if (modelProvider === "openai" && modelName !== "gpt-4-turbo" && modelName !== "gpt-3.5-turbo") {
            return new ChatOpenAI({ apiKey: this.apiKeys.openai, model: modelName, temperature: 0.2, streaming: true });
        }
        if (modelProvider === "google" && modelName !== "gemini-2.5-pro" && modelName !== "gemini-2.5-pro") {
            return new ChatGoogleGenerativeAI({ apiKey: this.apiKeys.google, model: modelName, temperature: 0.2, streaming: true });
        }
        if (modelProvider === "anthropic" && modelName !== "claude-3-sonnet-20240229" && modelName !== "claude-3-haiku-20240307") {
            return new ChatAnthropic({ apiKey: this.apiKeys.anthropic, model: modelName, temperature: 0.2, streaming: true });
        }
        return this.models[`${modelProvider}_capable`];
    }

    shouldSearchWeb(userInput) {
        const lowerInput = userInput.toLowerCase();

        if (lowerInput.includes("search for") || lowerInput.includes("look up") ||
            lowerInput.includes("find information on") || lowerInput.includes("web search for")) {
            console.log(`[shouldSearchWeb] TRUE: Explicit command`);
            return true;
        }

        const timeSensitiveKeywords = ["latest", "current", "recent", "news", "today", "yesterday", "now", "breaking", "update", "2024", "2025"];
        if (timeSensitiveKeywords.some(keyword => lowerInput.includes(keyword))) {
            console.log(`[shouldSearchWeb] TRUE: Time-sensitive keyword`);
            return true;
        }

        if (lowerInput.includes("who is the current") || lowerInput.includes("what is the stock price") ||
            lowerInput.includes("weather in") || lowerInput.includes("election results") ||
            lowerInput.includes("current events") || lowerInput.includes("what's happening")) {
            console.log(`[shouldSearchWeb] TRUE: Dynamic fact query`);
            return true;
        }

        console.log(`[shouldSearchWeb] FALSE: No strong search indicator`);
        return false;
    }

    async *_streamGenerate(llm, promptMessages, originalQuery) {
        let accumulatedContent = '';
        try {
            const stream = await llm.stream(promptMessages);
            for await (const chunk of stream) {
                if (chunk.content) {
                    accumulatedContent += chunk.content;
                    yield chunk.content;
                }
            }
        } catch (error) {
            console.error(`LLM Streaming Error for query "${originalQuery}":`, error);
            const fallbackMessages = await ERROR_FALLBACK_PROMPT.formatMessages({ original_query: originalQuery });
            const fallbackStream = await this.models.openai_fast?.stream(fallbackMessages) || await this.models.google_fast?.stream(fallbackMessages);
            if (fallbackStream) {
                for await (const chunk of fallbackStream) {
                    yield chunk.content || '';
                }
            } else {
                yield `Error generating response: ${error.message}`;
            }
        }
    }

    async *processMessage(userMessage, modelProvider, modelName = "gpt-4-turbo", forceSearch = false) {
        console.log(`[LangChainChatAgent] Processing message: "${userMessage}" with provider: ${modelProvider}, model: ${modelName}`);
        let llm = this._getLLM(modelProvider, modelName);
        if (!llm) {
            yield JSON.stringify({ type: "error", data: `Error: Model provider "${modelProvider}" not initialized or model "${modelName}" not found. Check API keys.` }) + "\n";
            yield JSON.stringify({ type: "end" }) + "\n";
            return;
        }

        let needsSearch = forceSearch || this.shouldSearchWeb(userMessage);
        let searchToolUsed = 'none';
        let searchContent = '';
        let searchSources = [];
        let isSearchSuccessful = false;

        try {
            if (needsSearch) {
                let cacheKey = `${userMessage.toLowerCase()}-${modelProvider}`;
                let cachedResult = this.searchCache[cacheKey];

                if (cachedResult && (Date.now() - cachedResult.timestamp < this.searchCacheTTL)) {
                    console.log(`[LangChainChatAgent] Cache Hit for search query: "${userMessage}"`);
                    searchContent = cachedResult.data.content;
                    searchSources = cachedResult.data.sources;
                    searchToolUsed = cachedResult.data.toolUsed;
                    isSearchSuccessful = true;
                } else {
                    console.log(`[LangChainChatAgent] Cache Miss. Performing live search for: "${userMessage}"`);

                    if (modelProvider === "google" && this.tools.google_search_grounding) {
                        console.log(`[LangChainChatAgent] Attempting Google Grounding for: "${userMessage}"`);
                        try {
                            const groundedResult = await this.tools.google_search_grounding._call({ query: userMessage });
                            searchContent = groundedResult;
                            searchSources = this.tools.google_search_grounding._parseCitations(
                                this.tools.google_search_grounding.cache[`grounded_${userMessage.toLowerCase()}`]?.citations // Retrieve citations from tool's cache if stored
                            ).map(c => c.url).filter(Boolean);
                            searchToolUsed = 'google_search_grounding';
                            isSearchSuccessful = true;
                            console.log(`[LangChainChatAgent] Google Grounding Result (first 200 chars): "${String(searchContent).substring(0, 200)}..."`);
                        } catch (toolError) {
                            console.error(`[LangChainChatAgent] Google Grounding Tool Error:`, toolError);
                            searchContent = `Error: Google Grounding failed for "${userMessage}": ${toolError.message}`;
                            searchToolUsed = 'google_search_grounding_failed';
                        }

                    } else if (this.tools.perplexity_web_search) {
                        console.log(`[LangChainChatAgent] Attempting Perplexity Search for: "${userMessage}"`);
                        try {
                            const perplexityResultContent = await this.tools.perplexity_web_search._call({ query: userMessage });
                            const fullPerplexityResult = this.tools.perplexity_web_search.cache[userMessage.toLowerCase()]?.data;

                            searchContent = perplexityResultContent;
                            searchSources = fullPerplexityResult?.sources || [];
                            searchToolUsed = 'perplexity_web_search';
                            isSearchSuccessful = true;
                            console.log(`[LangChainChatAgent] Perplexity Search Result (first 200 chars): "${String(searchContent).substring(0, 200)}..."`);
                        } catch (toolError) {
                            console.error(`[LangChainChatAgent] Perplexity Search Tool Error:`, toolError);
                            searchContent = `Error: Perplexity search failed for "${userMessage}": ${toolError.message}`;
                            searchToolUsed = 'perplexity_web_search_failed';
                        }
                    } else {
                        console.warn(`[LangChainChatAgent] No suitable search tool available for provider ${modelProvider}. Answering without explicit search.`);
                        searchContent = `(No search tool available for your request.)`;
                        needsSearch = false;
                    }

                    if (isSearchSuccessful) {
                        this.searchCache[cacheKey] = {
                            data: { content: searchContent, sources: searchSources, toolUsed: searchToolUsed },
                            timestamp: Date.now()
                        };
                    }
                }
            }

            yield JSON.stringify({
                type: "metadata",
                data: { usedSearch: needsSearch, searchTool: searchToolUsed, searchSources: searchSources, isSearchSuccessful: isSearchSuccessful }
            }) + "\n";


            let messagesForLLM;
            if (needsSearch && isSearchSuccessful) {
                messagesForLLM = await RAG_PROMPT_TEMPLATE.formatMessages({
                    search_context: searchContent,
                    user_input: userMessage
                });
                console.log(`[LangChainChatAgent] Using RAG prompt. LLM will process ${searchContent.length} chars of context.`);
            } else {
                messagesForLLM = [
                    new SystemMessage("You are a helpful AI assistant. Respond directly to the user's question."),
                    new HumanMessage(userMessage)
                ];
                console.log(`[LangChainChatAgent] Using direct prompt (no search context).`);
            }

            for await (const chunk of this._streamGenerate(llm, messagesForLLM, userMessage)) {
                yield JSON.stringify({ type: "chunk", data: chunk }) + "\n";
            }

        } catch (error) {
            console.error("[LangChainChatAgent] Top-level processMessage error:", error);
            yield JSON.stringify({ type: "error", data: error.message || "An unexpected error occurred during processing." }) + "\n";
        } finally {
            yield JSON.stringify({ type: "end" }) + "\n";
        }
    }
}

export { LangChainChatAgent };