// Require the framework and instantiate it

// ESM
import Fastify from 'fastify'
import Redis from 'ioredis'
import dotenv from 'dotenv'

dotenv.config()

const fastify = Fastify({
  logger: true
})

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379' // Default if not in .env
let redis

async function connectToRedis() {
  try {
    redis = new Redis(REDIS_URL, { 
      // Adding a connect timeout to get a clearer error if it's a network issue
      connectTimeout: 10000, // 10 seconds
      // Optional: a specific retry strategy can be helpful for debugging
      retryStrategy(times) {
        const delay = Math.min(times * 150, 2000); // wait up to 2 seconds
        fastify.log.warn(`Redis/Valkey: Retrying connection (attempt ${times}), delay ${delay}ms`);
        return delay;
      }
    });
    fastify.log.info('Attempting to connect to Redis/Valkey...');

    await new Promise((resolve, reject) => {
      redis.on('connect', () => {
        fastify.log.info('Successfully connected to Redis/Valkey!');
        resolve();
      });
      redis.on('error', (err) => {
        // Log the error object and a more descriptive message
        fastify.log.error({ err: { message: err.message, stack: err.stack, code: err.code, address: err.address, port: err.port } }, 'Redis/Valkey connection error event');
        // No need to reject here if we want ioredis to handle retries based on retryStrategy
        // If we reject, the server might not start or handle it as gracefully.
        // The 'ready' event or further errors will indicate the final state.
      });
      redis.on('ready', () => {
        fastify.log.info('Redis/Valkey client is ready!');
        // If we resolve on 'connect', we might not need to resolve again on 'ready'
        // unless the initial promise is still pending due to no 'connect' yet.
        if (redis.status === 'ready' && !fastify.server.listening) {
             // This ensures the initial connection promise resolves if 'connect' was missed or delayed
            resolve(); 
        }
      });
      redis.on('close', () => {
        fastify.log.warn('Redis/Valkey connection closed.');
      });
      redis.on('reconnecting', () => {
        fastify.log.info('Redis/Valkey client is reconnecting...');
      });
      redis.on('end', () => {
        fastify.log.warn('Redis/Valkey connection has ended (no more retries).');
        // This is a good place to reject if the initial connection never established
        // and we want the connectToRedis promise to fail.
        if (!redis.status || redis.status !== 'ready') {
            reject(new Error('Failed to connect to Redis/Valkey after retries.'));
        }
      });
    });
  } catch (err) {
    fastify.log.error({ err: { message: err.message, stack: err.stack, code: err.code } }, 'Failed to initialize Redis/Valkey connection in try-catch block');
    // We might want to exit or retry, but for now, we'll let the server start
    // and the endpoints will show errors.
  }
}

// Declare a route
fastify.get('/', function (request, reply) {
  reply.send({ hello: 'world', redis_status: redis ? (redis.status === 'ready' ? 'connected' : redis.status) : 'disconnected' })
})

// Test Endpoints
fastify.post('/test/set', async function (request, reply) {
  if (!redis || redis.status !== 'ready') {
    return reply.status(503).send({ error: 'Redis not connected' })
  }
  try {
    const { key, value } = request.body
    if (!key || value === undefined) {
      return reply.status(400).send({ error: 'Missing key or value in request body' })
    }
    await redis.set(key, value)
    reply.send({ success: true, message: `Set key '${key}' to '${value}'` })
  } catch (err) {
    fastify.log.error(err)
    reply.status(500).send({ error: 'Failed to set key in Redis', details: err.message })
  }
})

fastify.get('/test/get/:key', async function (request, reply) {
  if (!redis || redis.status !== 'ready') {
    return reply.status(503).send({ error: 'Redis not connected' })
  }
  try {
    const { key } = request.params
    const value = await redis.get(key)
    if (value === null) {
      return reply.status(404).send({ error: `Key '${key}' not found` })
    }
    reply.send({ success: true, key, value })
  } catch (err) {
    fastify.log.error(err)
    reply.status(500).send({ error: 'Failed to get key from Redis', details: err.message })
  }
})

fastify.post('/test/lpush', async function (request, reply) {
  if (!redis || redis.status !== 'ready') {
    return reply.status(503).send({ error: 'Redis not connected' })
  }
  try {
    const { key, value } = request.body
     if (!key || value === undefined) {
      return reply.status(400).send({ error: 'Missing key or value in request body' })
    }
    await redis.lpush(key, value)
    reply.send({ success: true, message: `LPUSHed '${value}' to list '${key}'` })
  } catch (err) {
    fastify.log.error(err)
    reply.status(500).send({ error: 'Failed to LPUSH to Redis list', details: err.message })
  }
})

fastify.get('/test/lrange/:key/:start/:stop', async function (request, reply) {
  if (!redis || redis.status !== 'ready') {
    return reply.status(503).send({ error: 'Redis not connected' })
  }
  try {
    const { key, start, stop } = request.params
    const values = await redis.lrange(key, parseInt(start, 10), parseInt(stop, 10))
    reply.send({ success: true, key, values })
  } catch (err) {
    fastify.log.error(err)
    reply.status(500).send({ error: 'Failed to LRANGE from Redis list', details: err.message })
  }
})

fastify.delete('/test/del/:key', async function (request, reply) {
  if (!redis || redis.status !== 'ready') {
    return reply.status(503).send({ error: 'Redis not connected' })
  }
  try {
    const { key } = request.params
    const result = await redis.del(key)
    if (result === 0) {
      return reply.status(404).send({ error: `Key '${key}' not found or not deleted` })
    }
    reply.send({ success: true, message: `Deleted key '${key}', count: ${result}` })
  } catch (err) {
    fastify.log.error(err)
    reply.status(500).send({ error: 'Failed to delete key from Redis', details: err.message })
  }
})


// Run the server!
const start = async () => {
  try {
    fastify.log.info('Server starting in 10 seconds...')
    await new Promise(resolve => setTimeout(resolve, 10000)) // 10-second delay

    await connectToRedis() // Attempt to connect to Redis

    await fastify.listen({ port: 3000 })
    fastify.log.info(`Server listening on ${fastify.server.address().port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()