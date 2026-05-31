import { PdfTemplate } from './types';
import { giraImportsTemplate } from './gira-imports.template';
import { neoFestasTemplate } from './neo-festas.template';
import { bm36Template } from './bm36.template';
import { dagiaTemplate } from './dagia.template';
import { nixTemplate } from './nix.template';
import { clinkTemplate } from './clink.template';
import { momentTemplate } from './moment.template';
import { lilaHomeTemplate } from './lila-home.template';
import { goalKidsTemplate } from './goal-kids.template';

const templates: PdfTemplate[] = [
  giraImportsTemplate,
  neoFestasTemplate,
  bm36Template,
  dagiaTemplate,
  nixTemplate,
  clinkTemplate,
  momentTemplate,
  lilaHomeTemplate,
  goalKidsTemplate,
];

export const detectTemplate = (texto: string): PdfTemplate | undefined => {
  for (const template of templates) {
    for (const pattern of template.identificationPatterns) {
      if (typeof pattern === 'string') {
        if (texto.toUpperCase().includes(pattern.toUpperCase())) {
          return template;
        }
      } else if (pattern instanceof RegExp) {
        if (pattern.test(texto)) {
          return template;
        }
      }
    }
  }
  return undefined;
};
