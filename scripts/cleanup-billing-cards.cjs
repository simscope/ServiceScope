const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '../src/components/OwnerPages.tsx');
let c = fs.readFileSync(p, 'utf8');
const a = ['        </div>', '        </div>'].join('');
const b = ['        </div>'].join('');
c = c.split(a).join(b);
fs.writeFileSync(p, c);
console.log('cleanup billing cards');
