import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * In Next.js development, asynchronous worker threads used by `transport: { target: "pino-pretty" }` 
 * get destroyed during Fast Refresh/HMR, throwing "Error: the worker has exited".
 * 
 * Using synchronous stdout streaming in development prevents worker thread crashes.
 */
function createLogger() {
  if (IS_DEV) {
    // Import pino-pretty synchronously to run on the main thread
    const pretty = require("pino-pretty");
    return pino(
      {
        level: LOG_LEVEL,
        base: { service: "solvigil" },
        serializers: {
          err: pino.stdSerializers.err,
          req: pino.stdSerializers.req,
          res: pino.stdSerializers.res,
        },
      },
      pretty({
        colorize: true,
        translateTime: "SYS:HH:MM:ss",
        ignore: "pid,hostname",
      })
    );
  }

  // Production JSON logging (zero-overhead)
  return pino({
    level: LOG_LEVEL,
    base: { service: "solvigil" },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  });
}

export const logger = createLogger();

/**
 * Creates a child logger with request context.
 */
export function childLogger(context: Record<string, any>) {
  return logger.child(context);
}