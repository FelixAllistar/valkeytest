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
    redis = new Redis(REDIS_URL)
    fastify.log.info('Attempting to connect to Redis/Valkey...')

    await new Promise((resolve, reject) => {
      redis.on('connect', () => {
        fastify.log.info('Successfully connected to Redis/Valkey!')
        resolve()
      })
      redis.on('error', (err) => {
        fastify.log.error('Redis/Valkey connection error:', err)
        reject(err)
      })
    })
  } catch (err) {
    fastify.log.error('Failed to initialize Redis/Valkey connection:', err)
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