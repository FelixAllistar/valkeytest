const BASE_URL = 'http://localhost:3000';
let testCount = 0;
let passCount = 0;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(path, options = {}, description) {
  testCount++;
  console.log(`\n[TEST #${testCount}] ${description}`);
  process.stdout.write(`Requesting: ${options.method || 'GET'} ${BASE_URL}${path}`);
  if (options.body) {
    process.stdout.write(` with Body: ${options.body}`);
  }
  process.stdout.write('\n');


  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const responseBody = await response.json().catch(() => response.text()); // Try to parse JSON, fallback to text

    console.log(`Status: ${response.status}`);
    console.log(`Response:`, responseBody);

    return { status: response.status, body: responseBody, response };
  } catch (error) {
    console.error(`Error during request to ${path}:`, error.message);
    return { status: 500, body: { error: error.message }, error };
  }
}

function check(condition, successMessage, failureMessage) {
  if (condition) {
    console.log(`✅ PASS: ${successMessage}`);
    passCount++;
    return true;
  } else {
    console.error(`❌ FAIL: ${failureMessage}`);
    return false;
  }
}

async function waitForServer() {
  console.log('Waiting for server to be ready (server has a 10s startup delay + Redis connection time)...');
  let ready = false;
  let attempts = 0;
  const maxAttempts = 25; // Wait for up to 25 * 2s = 50s
  while (!ready && attempts < maxAttempts) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1900); // Shorter timeout for individual attempt
      const response = await fetch(`${BASE_URL}/`, {signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const body = await response.json();
        if (body.redis_status === 'connected') {
           console.log('Server and Redis are ready!');
           ready = true;
        } else {
            process.stdout.write(`Server up, Redis status: ${body.redis_status}. Retrying (${attempts + 1}/${maxAttempts})...\r`);
        }
      } else {
        process.stdout.write(`Server not ready (status ${response.status}). Retrying (${attempts + 1}/${maxAttempts})...\r`);
      }
    } catch (e) {
      process.stdout.write(`Server not reachable. Retrying (${attempts + 1}/${maxAttempts})...\r`);
    }
    if (!ready) {
      attempts++;
      await delay(2000); // Wait 2 seconds before retrying
    }
  }
  console.log(''); // Newline after retries
  if (!ready) {
    console.error('Server did not become ready in time. Aborting tests.');
    process.exit(1);
  }
}


async function runTests() {
  await waitForServer();

  // Test 1: Check Server and Redis/Valkey Connection Status
  let res = await makeRequest('/', {}, 'Check Server and Redis/Valkey Connection Status');
  check(res.status === 200 && res.body.hello === 'world' && res.body.redis_status === 'connected',
        'Server is up and Redis connected.',
        `Server status check failed. Expected 200 and specific body. Got status ${res.status} and body ${JSON.stringify(res.body)}`);

  // Test 2: SET a key
  const testKey = `testkey_${Date.now()}`;
  const testValue = `testvalue_${Date.now()}`;
  res = await makeRequest('/test/set', { method: 'POST', body: JSON.stringify({ key: testKey, value: testValue }) }, 'SET a key');
  check(res.status === 200 && res.body.success === true,
        `Successfully set key '${testKey}'.`,
        `Failed to set key. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Test 3: GET the key
  res = await makeRequest(`/test/get/${testKey}`, {}, 'GET the previously set key');
  check(res.status === 200 && res.body.success === true && res.body.value === testValue,
        `Successfully retrieved key '${testKey}' with correct value.`,
        `Failed to get key or value mismatch. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Test 4: GET a non-existent key
  const nonExistentKey = `nonexistent_${Date.now()}`;
  res = await makeRequest(`/test/get/${nonExistentKey}`, {}, 'GET a non-existent key');
  check(res.status === 404 && res.body.error,
        `Correctly got 404 for non-existent key '${nonExistentKey}'.`,
        `Incorrect response for non-existent key. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Test 5: LPUSH to a list
  const testListKey = `testlist_${Date.now()}`;
  const item1 = 'item1';
  const item0 = 'item0';
  res = await makeRequest('/test/lpush', { method: 'POST', body: JSON.stringify({ key: testListKey, value: item1 }) }, `LPUSH '${item1}' to list '${testListKey}'`);
  check(res.status === 200 && res.body.success === true, `LPUSHed '${item1}'.`, `LPUSH failed. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  res = await makeRequest('/test/lpush', { method: 'POST', body: JSON.stringify({ key: testListKey, value: item0 }) }, `LPUSH '${item0}' to list '${testListKey}'`);
  check(res.status === 200 && res.body.success === true, `LPUSHed '${item0}'.`, `LPUSH failed. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Test 6: LRANGE from the list
  res = await makeRequest(`/test/lrange/${testListKey}/0/-1`, {}, `LRANGE from list '${testListKey}'`);
  check(res.status === 200 && res.body.success === true && Array.isArray(res.body.values) && res.body.values.join(',') === `${item0},${item1}`,
        `Successfully retrieved list with items '${item0},${item1}'. Got: ${JSON.stringify(res.body.values)}`,
        `Failed to retrieve list or items mismatch. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Test 7: DEL the string key
  res = await makeRequest(`/test/del/${testKey}`, { method: 'DELETE' }, `DEL the key '${testKey}'`);
  check(res.status === 200 && res.body.success === true && res.body.message && res.body.message.includes('count: 1'),
        `Successfully deleted key '${testKey}'.`,
        `Failed to delete key. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Verify deletion of string key
  res = await makeRequest(`/test/get/${testKey}`, {}, `Verify GET non-existent after DEL for key '${testKey}'`);
  check(res.status === 404, `Correctly got 404 for deleted key '${testKey}'.`, `Key '${testKey}' still exists or wrong error. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);


  // Test 8: DEL a non-existent key
  res = await makeRequest(`/test/del/${nonExistentKey}`, { method: 'DELETE' }, `DEL a non-existent key '${nonExistentKey}'`);
  check(res.status === 404 && res.body.error,
        `Correctly handled DEL for non-existent key '${nonExistentKey}'.`,
        `Incorrect response for DEL non-existent key. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Test 9: DEL the list key
  res = await makeRequest(`/test/del/${testListKey}`, { method: 'DELETE' }, `DEL the list '${testListKey}'`);
  check(res.status === 200 && res.body.success === true && res.body.message && res.body.message.includes('count: 1'),
        `Successfully deleted list '${testListKey}'.`,
        `Failed to delete list. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  // Verify deletion of list key
  res = await makeRequest(`/test/lrange/${testListKey}/0/-1`, {}, `Verify LRANGE non-existent after DEL for list '${testListKey}'`);
  check(res.status === 200 && Array.isArray(res.body.values) && res.body.values.length === 0,
        `Correctly got empty list for deleted list '${testListKey}'.`,
        `List '${testListKey}' still has items or wrong error. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);

  console.log(`\n--- Test Summary ---`);
  console.log(`Total Tests: ${testCount}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${testCount - passCount}`);
  console.log(`--------------------`);

  if (testCount === passCount) {
    console.log("🎉 All tests passed! Valkey integration seems to be working. 🎉");
    process.exit(0);
  } else {
    console.error("🔥 Some tests failed. Please review the logs. 🔥");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Unhandled error during test execution:", err);
  process.exit(1);
}); 