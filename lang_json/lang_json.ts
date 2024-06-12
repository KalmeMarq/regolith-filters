import { existsSync, walkSync } from 'jsr:@std/fs@0.229.1';
import { basename } from 'jsr:@std/path@0.225.1';

function convertJsonToLang(content: string) {
  return content
    .replace(/"(?<key>[^"]*)":\s*"(?<value>[^"]*)",?(\s*\/\/(?<comment>.+))?/g, (_, b, c, __, e) => {
      return b + '=' + c + '\t#' + (e != null ? '##' + e : '');
    })
    .replace(/^[^"]*(\n[^"]*){0,}{/g, (a) => {
      return a.slice(0, -1);
    })
    .replace(/}[^"]*(\n[^"]*){0,}$/g, (a) => {
      return a.slice(1);
    })
    .replace(/^.*\/\/(?<comment>.+)$/gm, (_, b) => {
      return '##' + b;
    })
    .replace(/^\s*\/\*(?<comment>[^*/]+)\*\//gm, (_, b) => {
      return b
        .split('\n')
        .map((it: string) => '##' + it)
        .join('\n');
    })
    .replace(/^[^\S\r\n]*/gm, '');
}

if (import.meta.main) {
  for (const pack of ['./RP', './BP']) {
    if (existsSync(pack + '/texts')) {
      for (const file of walkSync(pack + '/texts')) {
        if (['languages.json', 'language_names.json'].includes(basename(file.path))) continue;

        if (file.path.endsWith('.json')) {
          Deno.writeTextFileSync(file.path.replace('.json', '.lang'), convertJsonToLang(Deno.readTextFileSync(file.path)));
          Deno.removeSync(file.path);
        }
      }
    }
  }
}
