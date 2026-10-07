const fs = require('fs');
const path = require('path');

console.log('Starting Quick Wins...');

// QUICK WIN 1: Remove weatherCache export from api/services/weather.js
const weatherPath = path.join(__dirname, 'api', 'services', 'weather.js');
let weatherContent = fs.readFileSync(weatherPath, 'utf8');
if (weatherContent.includes('module.exports = {')) {
  weatherContent = weatherContent.replace(/module\.exports = \{[\s\S]*?weatherCache\s*,?[\s\S]*?\}/, 
    `module.exports = {
  getWeatherContext,
  weatherCache // Keep for internal use but don't export
};`);
  fs.writeFileSync(weatherPath, weatherContent);
  console.log('✅ Quick Win 1: weatherCache export removed');
} else {
  console.log('⚠️ Quick Win 1: Pattern not found');
}

// QUICK WIN 2: Add TTL cleanup to activeGroupTableCarts
const ordersPath = path.join(__dirname, 'api', 'routes', 'orders.js');
let ordersContent = fs.readFileSync(ordersPath, 'utf8');
if (!ordersContent.includes('cleanupActiveGroupCarts')) {
  const cleanupFn = `
// TTL cleanup for active group carts (24h max age)
const GROUP_CART_TTL_MS = 24 * 60 * 60 * 1000;
function cleanupActiveGroupCarts() {
  const now = Date.now();
  for (const [key, cart] of activeGroupTableCarts.entries()) {
    if (cart.lastActivity && (now - cart.lastActivity > GROUP_CART_TTL_MS)) {
      activeGroupTableCarts.delete(key);
      console.log('[GroupCart] Cleaned up expired cart:', key);
    }
  }
}
// Run cleanup every hour
setInterval(cleanupActiveGroupCarts, 60 * 60 * 1000);
`;
  ordersContent = ordersContent.replace(
    /const activeGroupTableCarts = new Map\(\);/,
    'const activeGroupTableCarts = new Map();\n' + cleanupFn
  );
  fs.writeFileSync(ordersPath, ordersContent);
  console.log('✅ Quick Win 2: TTL cleanup added to activeGroupTableCarts');
} else {
  console.log('⚠️ Quick Win 2: Already exists');
}

// QUICK WIN 3: Replace formatMenuPrice in menu.js
const menuPath = path.join(__dirname, 'public', 'js', 'menu.js');
let menuContent = fs.readFileSync(menuPath, 'utf8');
const formatMenuPriceRegex = /function formatMenuPrice\(amount\) \{[\s\S]*?return amount\.toFixed\(2\);\s*\}/;
if (formatMenuPriceRegex.test(menuContent)) {
  menuContent = menuContent.replace(formatMenuPriceRegex, 
    `// formatMenuPrice deprecated - use window.i18nManager.formatPrice()
function formatMenuPrice(amount) {
  if (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') {
    return window.i18nManager.formatPrice(amount);
  }
  // Fallback for early initialization
  const currency = restaurantData?.currency || '$';
  return \`\${currency} \${Number(amount).toFixed(2)}\`;
}`);
  fs.writeFileSync(menuPath, menuContent);
  console.log('✅ Quick Win 3: formatMenuPrice redirected to i18nManager');
} else {
  console.log('⚠️ Quick Win 3: Already replaced or not found');
}

console.log('Quick Wins 1-3 done. Now fixing escapeHtml imports...');

// QUICK WIN 4 & 5: Replace inline escapeHtml with import from utils
const filesToFix = [
  { path: path.join(__dirname, 'public', 'js', 'menu.js'), importLine: "import { escapeHtml } from '/js/utils/escapeHtml.js';" },
  { path: path.join(__dirname, 'public', 'js', 'studio.js'), importLine: "import { escapeHtml } from '/js/utils/escapeHtml.js';" },
  { path: path.join(__dirname, 'public', 'js', 'components', 'GroupCartManager.js'), importLine: "import { escapeHtml } from '/js/utils/escapeHtml.js';" },
  { path: path.join(__dirname, 'public', 'js', 'components', 'VirtualWaiter.js'), importLine: "import { escapeHtml } from '/js/utils/escapeHtml.js';" },
  { path: path.join(__dirname, 'public', 'js', 'components', 'LoyaltyRewardsModal.js'), importLine: "import { escapeHtml } from '/js/utils/escapeHtml.js';" }
];

for (const file of filesToFix) {
  if (fs.existsSync(file.path)) {
    let content = fs.readFileSync(file.path, 'utf8');
    if (!content.includes("from '/js/utils/escapeHtml.js'")) {
      // Add import at the top after existing imports or at the very top
      if (content.startsWith('import ') || content.includes('\nimport ')) {
        content = content.replace(/((?:import .*?;\n)+)/, '$1' + file.importLine + '\n');
      } else {
        content = file.importLine + '\n' + content;
      }
      // Remove inline escapeHtml function (various patterns)
      content = content.replace(/function escapeHtml\(str\) \{[\s\S]*?return String\(str\)[\s\S]*?\}/g, '');
      content = content.replace(/escapeHtml\(str\) \{[\s\S]*?return String\(str\)[\s\S]*?\}/g, '');
      content = content.replace(/const escapeHtml = \(str\) => \{[\s\S]*?\};/g, '');
      fs.writeFileSync(file.path, content);
      console.log(`✅ ${path.basename(file.path)}: import added, inline removed`);
    } else {
      console.log(`⚠️ ${path.basename(file.path)}: Already has import`);
    }
  }
}

console.log('\n🎉 All Quick Wins completed!');