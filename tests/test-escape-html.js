// Test para escapeHtml - TDD: RED phase
const assert = require('assert');
const { escapeHtml } = require('../public/js/utils/escapeHtml.js');

console.log('Testing escapeHtml...');

// Test 1: Basic HTML entities
const test1 = escapeHtml('<script>alert("xss")</script>');
assert.strictEqual(test1, "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;", 'Should escape < > "');
console.log('✓ Test 1 passed: basic entities');

// Test 2: Ampersand
const test2 = escapeHtml('Tom & Jerry');
assert.strictEqual(test2, "Tom &amp; Jerry", 'Should escape &');
console.log('✓ Test 2 passed: ampersand');

// Test 3: Single quote
const test3 = escapeHtml("O'Reilly");
assert.strictEqual(test3, "O&#039;Reilly", 'Should escape single quote');
console.log('✓ Test 3 passed: single quote');

// Test 4: Empty/null/undefined
assert.strictEqual(escapeHtml(''), '', 'Empty string returns empty');
assert.strictEqual(escapeHtml(null), '', 'Null returns empty');
assert.strictEqual(escapeHtml(undefined), '', 'Undefined returns empty');
console.log('✓ Test 4 passed: falsy values');

// Test 5: Numbers
assert.strictEqual(escapeHtml(42), '42', 'Numbers converted to string');
console.log('✓ Test 5 passed: numbers');

// Test 6: Already escaped (idempotent)
const already = '<script>';
assert.strictEqual(escapeHtml(already), "&lt;script&gt;", 'Already escaped gets re-escaped');
console.log('✓ Test 6 passed: idempotent behavior');

console.log('\n✅ All escapeHtml tests passed!');
