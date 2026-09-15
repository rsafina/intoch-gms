const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const staff = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const reserve = fs.readFileSync(path.join(root, "reserve.template.html"), "utf8");

assert.match(staff, /id="set-address-url"/);
assert.match(app, /address_url: addressUrl \|\| null/);
assert.match(app, /if \(address\) address\.value = fm\.address_url \?\? ""/);
assert.match(app, /\.select\(\)/, "settings writes must confirm a returned row");

assert.match(reserve, /id="btn-location"[\s\S]*?href=""[\s\S]*?hidden/);
assert.match(reserve, /id="btn-fullmenu"[\s\S]*?href=""[\s\S]*?hidden/);
assert.match(reserve, /id="btn-menu-sheet"[^>]*hidden/);
assert.match(reserve, /\$\("btn-location"\)\.hidden = false/);
assert.match(reserve, /\$\("btn-fullmenu"\)\.hidden = false/);
assert.match(reserve, /\$\("btn-menu-sheet"\)\.hidden = false/);

assert.doesNotMatch(reserve, /1A2M5iYbCJC_H9hD-793q4k3O49TpAsBH/);
assert.doesNotMatch(reserve, /Sirloin Wagyu MB5|Butter Salmon/);
assert.doesNotMatch(reserve, /href="https:\/\/maps\.google\.com\/"/);

const addButton = staff.indexOf('onclick="openDishModal()"');
const dishGrid = staff.indexOf('id="dishes-signature"');
assert.ok(addButton > 0 && addButton < dishGrid, "Add Dish belongs immediately above the dish groups");

console.log("Reservation form guest links and safe empty states: passed");
