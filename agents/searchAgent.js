import axios from 'axios';

class SearchResult {
    constructor(content, sources, citations) {
        this.content = content;
        this.sources = sources;
        this.citations = citations;
    }
}

class PerplexitySearchAgent {
    constructor(apiKey) {
        if (!apiKey) {
            console.warn("Perplexity API key is missing. PerplexitySearchAgent will not function.");
            this.apiKey = null;
        } else {
            this.apiKey = apiKey;
        }
        this.baseUrl = 'https://api.perplexity.ai/chat/completions';
    }

    async searchWeb(query, model = 'sonar') {
        if (!this.apiKey) {
            throw new Error("Perplexity API key is not set. Cannot perform search.");
        }

        const headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };

        const payload = {
            model: model,
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful research assistant. Provide concise, directly relevant information from the web to answer the user\'s question.'
                },
                {
                    role: 'user',
                    content: `Search for: ${query}`
                }
            ],
            max_tokens: 750, // Optimized for conciseness
            temperature: 0.2,
            return_citations: true,
            return_images: false,
            web_search_options: {
                "search_context_size": "medium"
            }

        };

        try {
            const response = await axios.post(this.baseUrl, payload, { headers });
            return this._parseSearchResult(response.data);
        } catch (error) {
            console.error(`Perplexity API request error for query "${query}":`, error.response?.status, error.response?.data || error.message);
            throw new Error(`Perplexity API error: ${error.response?.status || error.message}`);
        }
    }

    _parseSearchResult(data) {
        const content = data.choices?.[0]?.message?.content || '';
        const citations = data.citations || [];
        const sources = citations.map(citation => citation.url || '').filter(url => url);

        return new SearchResult(content, sources, citations);
    }
}

export { PerplexitySearchAgent, SearchResult };