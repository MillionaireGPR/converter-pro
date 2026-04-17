const fs = require('fs');
const content = fs.readFileSync('src/pages/DescontosCatalogos.tsx', 'utf8');
let open = 0;
let close = 0;
for (const char of content) {
  if (char === '{') open++;
  if (char === '}') close++;
}
console.log('Chaves - Abre:', open, 'Fecha:', close, 'Diferenca:', open - close);

let openP = 0;
let closeP = 0;
for (const char of content) {
  if (char === '(') openP++;
  if (char === ')') closeP++;
}
console.log('Parenteses - Abre:', openP, 'Fecha:', closeP, 'Diferenca:', openP - closeP);
