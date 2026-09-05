export class ChatError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

export const fail = (status: number, code: string, message: string): never => { throw new ChatError(status, code, message) }
