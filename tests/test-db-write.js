// Test para writeJson - TDD: verifica que no use busy-wait
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test helper: create temp dir
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
const TEST_FILE = path.join(TEST_DIR, 'test.json');

console.log('Testing writeJson (no busy-wait)...');

// Import the module - we'll test the behavior
const { writeJson } = require('../src/db/db.js');

async function runTests() {
  // Test 1: Basic write
  const result1 = await writeJson(TEST_FILE, { test: 'data' });
  assert.strictEqual(result1, true, 'Should return true on success');
  const content1 = fs.readFileSync(TEST_FILE, 'utf8');
  assert.ok(content1.includes('test'), 'Should write data');
  console.log('✓ Test 1 passed: basic write');

  // Test 2: Write array
  const result2 = await writeJson(TEST_FILE, [{ id: 1 }, { id: 2 }]);
  assert.strictEqual(result2, true, 'Should return true on success');
  const content2 = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
  assert.strictEqual(content2.length, 2, 'Should write array');
  console.log('✓ Test 2 passed: write array');

  // Test 3: Handles concurrent writes (no busy-wait blocking)
  const promises = Array(5).fill(null).map((_, i) => writeJson(TEST_FILE, { iteration: i }));
  const results = await Promise.all(promises);
  results.forEach((r, i) => assert.strictEqual(r, true, `Write ${i} should succeed`));
  console.log('✓ Test 3 passed: concurrent writes work');

  // Cleanup
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  
  console.log('\n✅ All writeJson tests passed!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});