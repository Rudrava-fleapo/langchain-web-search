import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { LangChainChatAgent } from './agents/chatAgent.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const apiKeys = {
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
};

const chatAgent = new LangChainChatAgent(apiKeys);

app.post('/chat', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust for your frontend domain

    const {
        message,
        modelProvider = 'openai',
        modelName = 'gpt-4-turbo',
        forceSearch = false
    } = req.body;

    if (!message) {
        // Send initial error in SSE format, then end
        res.write(`data: ${JSON.stringify({ type: "error", data: 'Message is required.' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "end" })}\n\n`);
        return res.end();
    }

    try {
        for await (const chunk of chatAgent.processMessage(message, modelProvider, modelName, forceSearch)) {
            if (res.writableEnded) {
                console.log("Client disconnected during stream.");
                break;
            }
            res.write(`data: ${chunk}\n\n`); // Each yield is an SSE data event
        }
    } catch (error) {
        console.error('SSE Chat endpoint top-level error:', error);
        // Ensure an error is sent if one wasn't caught and yielded by the agent
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: "error", data: error.message || "An unknown streaming error occurred." })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "end" })}\n\n`);
        }
    } finally {
        if (!res.writableEnded) {
            res.end(); // Always close the stream
        }
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});