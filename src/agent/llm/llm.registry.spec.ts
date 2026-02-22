import { buildLlm } from './llm.registry';

// Mocks defined inside factory functions to avoid Jest hoisting issues
jest.mock('@langchain/openai', () => ({
    ChatOpenAI: jest.fn().mockImplementation(() => ({ invoke: jest.fn() })),
}));

jest.mock('@langchain/deepseek', () => ({
    ChatDeepSeek: jest.fn().mockImplementation(() => ({ invoke: jest.fn() })),
}));

// Access the mocked constructors after jest.mock has hoisted them
import { ChatOpenAI } from '@langchain/openai';
import { ChatDeepSeek } from '@langchain/deepseek';
const MockChatOpenAI = ChatOpenAI as unknown as jest.Mock;
const MockChatDeepSeek = ChatDeepSeek as unknown as jest.Mock;

describe('buildLlm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('creates OpenAI LLM with default model', () => {
        buildLlm({ provider: 'openai', apiKey: 'sk-openai', model: undefined });

        expect(MockChatOpenAI).toHaveBeenCalledWith(
            expect.objectContaining({ modelName: 'gpt-4o-mini', apiKey: 'sk-openai', temperature: 0 }),
        );
        expect(MockChatDeepSeek).not.toHaveBeenCalled();
    });

    it('creates OpenAI LLM with custom model', () => {
        buildLlm({ provider: 'openai', apiKey: 'sk-openai', model: 'gpt-4o' });

        expect(MockChatOpenAI).toHaveBeenCalledWith(
            expect.objectContaining({ modelName: 'gpt-4o' }),
        );
    });

    it('creates DeepSeek LLM with default model', () => {
        buildLlm({ provider: 'deepseek', apiKey: 'sk-deepseek', model: undefined });

        expect(MockChatDeepSeek).toHaveBeenCalledWith(
            expect.objectContaining({
                modelName: 'deepseek-chat',
                apiKey: 'sk-deepseek',
                temperature: 0,
            }),
        );
        expect(MockChatOpenAI).not.toHaveBeenCalled();
    });

    it('creates DeepSeek LLM with custom model', () => {
        buildLlm({ provider: 'deepseek', apiKey: 'sk-deepseek', model: 'deepseek-reasoner' });

        expect(MockChatDeepSeek).toHaveBeenCalledWith(
            expect.objectContaining({ modelName: 'deepseek-reasoner' }),
        );
    });

    it('throws for unsupported provider', () => {
        expect(() =>
            buildLlm({ provider: 'anthropic' as any, apiKey: 'key' }),
        ).toThrow('Unsupported LLM provider: "anthropic"');
    });
});
