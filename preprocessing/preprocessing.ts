import { existsSync, walkSync } from 'jsr:@std/fs@0.229.1';
import { resolve } from 'jsr:@std/path@0.225.1';
import jsepNumbers from 'npm:@jsep-plugin/numbers@1.0.1';
import jsepTernary from 'npm:@jsep-plugin/ternary@1.1.3';
import jsep from 'npm:jsep@1.3.8';

jsep.plugins.register(jsepNumbers);
jsep.plugins.register(jsepTernary);

jsep.addBinaryOp('**', 11, true);
jsep.addBinaryOp('^', 10);

const DIRECTIVES_REGEX = {
  IGNORE: /^#ignore\s+(?<content>(.+))/,
  IF: /^#if\s+(?<expression>.+)/,
  IFDEF: /^#ifdef\s+(?<define>\w+)/,
  IFNDEF: /^#ifndef\s+(?<define>\w+)/,
  ELIF: /^#elif\s+(?<expression>.+)/,
  ELSE: /^#else\s*/,
  ENDIF: /^#endif/,
  DEFINE: /^#define\s+(?<define>\w+)\s*(\((?<params>\w+(,\s*\w+){0,})\)(\s+)(?<body>.+)|\s+(?<content>.+))/,
  UNDEF: /^#undef\s+(?<define>\w+)/,
  LOGGING: /^#(?<logtype>warn|error|info)\s+(?<content>.+)/,
  EXCLUDE: /^#exclude\s*/,
  ENDEXCLUDE: /^#endexclude\s*/,
  FOR: /^#for\s(?<start>\w+)\s+@\s+(?<end>\w+)\s*/,
  ENDFOR: /^#endfor\s*/,
  INCLUDE: /^#(?<type>\[[a-zA-Z-0-9]\]+)?include\s+"(?<file>[a-zA-Z0-9.\/_]+)"/,
  SAVE: /^#save\s+(?<save>\w+)/,
  ENDSAVE: /^#endsave\s*/,
  PASTE: /^#paste\s+(?<save>\w+)/
};

const MCPE_VERSION_REGEX = /MCPE_(?<major>\d{1,3})_(?<minor>\d{1,3})(_(?<patch>\d{1,3}))?/;

interface ExpressionHandler {
  onCall(name: string, args: any[]): any;
  onIdentifier(name: string): any;
  evalValue(value: any): any;
  withContext(context: DefineContext): ExpressionHandler;
  [key: string]: any;
}

function removeQuotes(value: string) {
  if (value.length > 1 && value[0] === '"' && value[value.length - 1] === '"') {
    return value.slice(1, -1);
  }
  return value;
}

function jsepEval(expression: jsep.Expression, handler: ExpressionHandler): { result: any; isIdentifier?: boolean } {
  if (expression.type === 'Literal') {
    return { result: expression.value };
  } else if (expression.type == 'Identifier') {
    return handler.onIdentifier(expression.name as string);
  } else if (expression.type == 'UnaryExpression') {
    const arg = handler.evalValue(jsepEval(expression.argument as jsep.Expression, handler));

    switch (expression.operator) {
      case '+':
        return { result: +arg };
      case '-':
        return { result: -arg };
      case '~':
        return { result: ~arg };
      case '!':
        return { result: !arg };
      default:
        throw new Error('jsep: Unknown operator ' + expression.operator);
    }
  } else if (expression.type == 'CallExpression') {
    const name = jsepEval(expression.callee as jsep.Expression, handler).result;
    const args = (expression as jsep.CallExpression).arguments.map((arg) => jsepEval(arg, handler));

    return handler.onCall(name, args);
  } else if (expression.type == 'ConditionalExpression') {
    const test = handler.evalValue(jsepEval(expression.test as jsep.Expression, handler));

    return test ? jsepEval(expression.consequent as jsep.Expression, handler) : jsepEval(expression.alternate as jsep.Expression, handler);
  } else if (expression.type == 'BinaryExpression') {
    const left = handler.evalValue(jsepEval(expression.left as jsep.Expression, handler));
    const right = handler.evalValue(jsepEval(expression.right as jsep.Expression, handler));

    switch (expression.operator) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return { result: '"' + (removeQuotes(left) + removeQuotes(right)) + '"' };
        }
        return { result: left + right };
      case '-':
        return { result: left - right };
      case '*':
        return { result: left * right };
      case '/':
        return { result: left / right };
      case '>>':
        return { result: left >> right };
      case '>>>':
        return { result: left >>> right };
      case '<<':
        return { result: left << right };
      case '&':
        return { result: left & right };
      case '**':
        return { result: left ** right };
      case '==':
        return { result: left == right };
      case '!=':
        return { result: left != right };
      case '===':
        return { result: left == right };
      case '!==':
        return { result: left == right };
      case '>':
        return { result: left > right };
      case '<':
        return { result: left < right };
      case '>=':
        return { result: left >= right };
      case '<=':
        return { result: left <= right };
      case '%':
        return { result: left % right };
      case '^':
        return { result: left ^ right };
      case '|':
        return { result: left | right };
      case '&&':
        return { result: left && right };
      case '||':
        return { result: left || right };
      default:
        throw new Error('jsep: Unknown operator ' + expression.operator);
    }
  }

  throw new Error('jsepEval: Unreachable code');
}

export type MCPEVersion = `MCPE_${number}` | `MCPE_${number}_${number}` | `MCPE_${number}_${number}_${number}`;
export type MCPEVersionWithComparision<T extends string> = `${T}${MCPEVersion}`;

export interface ConfigProfile {
  version: MCPEVersionWithComparision<'>'> | MCPEVersionWithComparision<'<'> | MCPEVersionWithComparision<'<='> | MCPEVersionWithComparision<'>='> | MCPEVersion;
  flags?: string[];
  minecraft_data_path?: string;
  resource_pack_path?: string;
  game_save_data_path?: string;
  custom_textures_path: string;
  custom_ui_path: string;
  minify?: string;
  obfuscate?: boolean;
  packs?: {
    resource_folder_name: string;
  };
}

export interface PackConfig {
  target_version: string; //`MCPE_${number}` | `MCPE_${number}_${number}` | `MCPE_${number}_${number}_${number}`;
  flags?: string[];
  include_paths?: string[];
  profiles?: ConfigProfile[];
  export?: 'development' | 'local';
}

type DefineType = 'constant' | 'function';
type Define = {
  name: string;
  value: string | number | null;
  cachedRegex: RegExp;
} & (
  | {
      type: 'constant';
    }
  | {
      type: 'function';
      args: string[];
    }
);

export function createDefine(name: string, value: string | number | null): Define {
  return { name, type: 'constant', value, cachedRegex: new RegExp('\\b' + name + '\\b') };
}

export function createDefineFunc(name: string, args: string[], value: string | number): Define {
  return {
    name,
    args,
    type: 'function',
    value,
    cachedRegex: new RegExp('\\b' + name + '\\(([a-zA-Z0-9_]+\\s*=\\s*)?([a-z-+._A-Z0-9]+|"[a-z_\\\\\\-/+.A-Z0-9%]+")\\s*(\\s*,\\s*([a-zA-Z0-9_]+\\s*=\\s*)?\\s*([a-z-+._/A-Z0-9]+|"[a-z_\\\\\\-/+.A-Z0-9%]+")){0,}\\)')
  };
}

type DynamicDefineCreator = (name: string) => [true, Define] | [false, undefined];

export class DefineContext {
  private _parent?: DefineContext;
  private _map: Map<string, Define>;
  private _dynamicCreator?: DynamicDefineCreator;

  constructor(parent?: DefineContext, dynamicCreator?: DynamicDefineCreator) {
    this._parent = parent;
    this._map = new Map();
    this._dynamicCreator = dynamicCreator;
  }

  add(define: Define) {
    this._map.set(define.name, define);
  }

  remove(defineName: string) {
    this._map.delete(defineName);
  }

  get(defineName: string): Define | undefined {
    if (this._dynamicCreator != null) {
      const [success, value] = this._dynamicCreator(defineName);
      if (success) {
        return value;
      }
    }

    return this._map.get(defineName) ?? (this._parent != null ? this._parent.get(defineName) : undefined);
  }

  has(defineName: string, type?: DefineType): boolean {
    const define = this._map.get(defineName) ?? (this._parent != null ? this._parent.get(defineName) : undefined);

    if (define == null) return false;

    if (type != null) {
      return define.type === type;
    }

    return true;
  }

  getDefines() {
    return this._map.values();
  }

  [Symbol.iterator](): Iterator<Define> {
    const that = this;
    function* iter() {
      for (const define of that._map.values()) {
        yield define;
      }

      if (that._parent != null) {
        for (const define of that._parent._map.values()) {
          yield define;
        }
      }
    }
    return iter();
  }
}

const exprHandler: ExpressionHandler = {
  context: null,
  withContext(context: DefineContext) {
    this.context = context;
    return this;
  },
  evalValue(value: any) {
    if ('isIdentifier' in value) {
      const d = this.context.get(value.result);
      return d != null ? d.value : 0;
    }
    return value.result;
  },
  getRandomInt(min: number, max: number) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled + 1) + minCeiled);
  },
  onCall(name, args) {
    if (name === 'red') return { result: (this.evalValue(args[0]) >> 16) & 0xff };
    if (name === 'green') return { result: (this.evalValue(args[0]) >> 8) & 0xff };
    if (name === 'blue') return { result: this.evalValue(args[0]) & 0xff };
    if (name === 'alpha') return { result: (this.evalValue(args[0]) >> 24) & 0xff };
    if (name === 'pow') return { result: Math.pow(this.evalValue(args[0]), this.evalValue(args[1])) };
    if (name === 'sin') return { result: Math.sin(this.evalValue(args[0])) };
    if (name === 'cos') return { result: Math.cos(this.evalValue(args[0])) };
    if (name === 'clamp') return { result: Math.max(this.evalValue(args[1]), Math.min(this.evalValue(args[2]), this.evalValue(args[0]))) };
    if (name === 'floor') return { result: Math.floor(this.evalValue(args[0])) };
    if (name === 'ceil') return { result: Math.ceil(this.evalValue(args[0])) };
    if (name === 'min') return { result: Math.min(...args.map((arg) => this.evalValue(arg))) };
    if (name === 'max') return { result: Math.max(...args.map((arg) => this.evalValue(arg))) };
    if (name === 'abs') return { result: Math.abs(this.evalValue(args[0])) };
    if (name === 'sign') return { result: Math.sign(this.evalValue(args[0])) };
    if (name === 'random') {
      switch (args.length) {
        case 0:
          return { result: Math.random() };
        case 1:
          return { result: this.getRandomInt(0, this.evalValue(args[0])) };
        default:
          return { result: this.getRandomInt(this.evalValue(args[0]), this.evalValue(args[1])) };
      }
    } else if (name === 'defined') {
      return { result: this.context.has(args[0].result) };
    }

    return { result: undefined };
  },
  onIdentifier(name) {
    if (name === 'it') return this.onIt();
    return { result: name, isIdentifier: true };
  }
};

function translateToJson(content: string) {
  return content
    .replace(/\r\n/gm, '\n')
    .replace(/(?!({[\n ]*))[a-zA-Z_+0-9#|$\:.@]+ = /gm, (a, b, c, d) => {
      return '"' + a.substring(0, a.indexOf('=')).trim() + '": ';
    })
    .replace(/(?<=^[ ]*)#.+/gm, (a) => {
      return '//' + a;
    });
}

export class Preprocessor {
  private static _cachedPathPreprocessors: Record<string, Preprocessor> = {};
  private _parentContext?: DefineContext;
  private _context: DefineContext;
  private _excluding = false;
  private _ifs: [boolean, boolean][] = [];

  private _saves: Map<string, string[]> = new Map();
  private _currentSave: string | null = null;
  private _includePaths: string[];

  constructor(parentContext?: DefineContext, includePaths: string[] = []) {
    this._parentContext = parentContext;
    this._context = new DefineContext(parentContext);
    this._includePaths = includePaths;
  }

  private reset() {
    this._context = new DefineContext(this._parentContext);
    this._excluding = false;
  }

  private canProcess(): boolean {
    return !this._excluding && this._ifs.every((it) => it[0] === true && it[1] === true);
  }

  public getContext() {
    return this._context;
  }

  private processLine(line: string): string {
    line = line.replace(/MCPE_(?<major>\d{1,3})_(?<minor>\d{1,3})(_(?<patch>\d{1,3}))?/gm, (a) => {
      return this._context.get(a)!.value + '';
    });

    line = line.replace(/##(.+?(?=##))?##/g, ((aa: string, bb: string) => {
      if (bb != null) {
        return this.evaluate(this._context, bb);
      }
      return aa;
    }) as any);

    for (const define of this._context) {
      if (define.type == 'function') {
        line = line.replace(define.cachedRegex, (a) => {
          // Get the arguments as an array
          const args = a
            .substring(a.indexOf('(') + 1, a.indexOf(')'))
            .split(',')
            .map((it) => it.trim())
            .map((it) => {
              if (it.includes('=')) {
                return { key: it.split('=')[0].trim(), value: it.split('=')[1].trim() };
              }
              if (it.startsWith("'") && it.endsWith("'")) {
                return { value: it.slice(1, -1) };
              }
              return { value: it };
            });

          // Save the arguments into define constants
          const funcContext = new DefineContext(this._context);
          for (let i = 0; i < define.args.length; ++i) {
            funcContext.add(createDefine(define.args[i], args[i] == null ? null : args[i].value));
          }

          // For every parameter usage inside a ## ##, evaluate the expression
          const m = (define.value + '').replace(/##(.+?(?=##))?##/g, ((aa: string, bb: string) => {
            if (bb != null) {
              return this.evaluate(funcContext, bb);
            }
            return aa;
          }) as any);
          return m;
        });
      } else {
        line = line.replace(define.cachedRegex, define.value + '');
      }
    }
    return line;
  }

  private evaluate(expression: string): any;
  private evaluate(context: DefineContext, expression: string): any;
  private evaluate(contextOrExpression: string | DefineContext, expression?: string): any {
    return exprHandler.withContext(typeof contextOrExpression === 'string' ? this._context : contextOrExpression).evalValue(jsepEval(jsep(expression != null ? expression : (contextOrExpression as string)), exprHandler));
  }

  private matchDirective(string: string, regex: RegExp) {
    const m = string.match(regex);
    if (m == null) {
      return null;
    }

    if (m.groups == null) {
      return {};
    }

    return m.groups!;
  }

  public process(content: string): [true, string] | [false, undefined] {
    this.reset();

    const lines = content.replaceAll('\r\n', '\n').split('\n');
    const result: string[] = [];

    for (let i = 0; i < lines.length; ++i) {
      const trimmedLine = lines[i].trimStart();

      let match: Record<string, string> | null;
      if (i === 0 && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.IGNORE)) != null) {
        if (Boolean(this.evaluate(match['content']))) {
          return [false, undefined];
        }
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.DEFINE)) != null) {
        if (match['body']) {
          const args = match['params'].split(',').map((it) => it.trim());

          const resultBody: string[] = [];
          if (match['body'].endsWith('\\')) {
            resultBody.push(match['body'].slice(0, -1));
            do {
              ++i;
              resultBody.push(lines[i].endsWith('\\') ? lines[i].slice(0, -1).trimEnd() : lines[i]);
            } while (lines[i].endsWith('\\'));
          } else {
            resultBody.push(match['body']);
          }

          this._context.add(createDefineFunc(match['define'], args, resultBody.join('\n')));
        } else {
          let resultBody: string[] = [];
          if (match['content'].endsWith('\\')) {
            resultBody.push(match['content'].slice(0, -1));
            do {
              ++i;
              resultBody.push(lines[i].endsWith('\\') ? lines[i].slice(0, -1).trimEnd() : lines[i]);
            } while (lines[i].endsWith('\\'));
          } else {
            resultBody.push(match['content']);
          }

          this._context.add(createDefine(match['define'], this.processLine(resultBody.join('\n'))));
        }
      } else if ((match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.IF)) != null) {
        const v = Boolean(this.evaluate(match['expression'])) == true;
        this._ifs.push([v, v]);
      } else if ((match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.IFDEF)) != null) {
        const v = this._context.has(match['define']);
        this._ifs.push([v, v]);
      } else if ((match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.IFNDEF)) != null) {
        const v = !this._context.has(match['define']);
        this._ifs.push([v, v]);
      } else if ((match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.ELIF)) != null) {
        const a0 = this._ifs[this._ifs.length - 1][0];
        const a1 = this._ifs[this._ifs.length - 1][1];
        const v = Boolean(this.evaluate(match['expression'])) == true;

        if (a0 && a1) {
          this._ifs[this._ifs.length - 1] = [false, true];
        } else if (!a0 && !a1) {
          this._ifs[this._ifs.length - 1] = [v, v];
        } else if (!a0 && a1) {
          this._ifs[this._ifs.length - 1] = [false, true];
        }
      } else if ((match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.ELSE)) != null) {
        this._ifs[this._ifs.length - 1] = [!this._ifs[this._ifs.length - 1][1], !this._ifs[this._ifs.length - 1][1]];
      } else if ((match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.ENDIF)) != null) {
        this._ifs.pop();
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.UNDEF)) != null) {
        this._context.remove(match['define']);
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.LOGGING)) != null) {
        switch (match['logtype']) {
          case 'info':
            console.log(`%cINFO (ln ${i + 1}'): ${this.processLine(match['content'])}`, 'color: green;');
            break;
          case 'warn':
            console.log(`%cWARN (ln ${i + 1}'): ${this.processLine(match['content'])}`, 'color: yellow;');
            break;
          case 'error':
            console.log(`%cERROR (ln ${i + 1}'): ${this.processLine(match['content'])}`, 'color: red;');
            break;
        }
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.EXCLUDE)) != null) {
        this._excluding = true;
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.ENDEXCLUDE)) != null) {
        this._excluding = false;
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.SAVE)) != null) {
        this._currentSave = match['save'];
        this._saves.set(this._currentSave, []);
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.ENDSAVE)) != null) {
        this._currentSave = null;
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.PASTE)) != null) {
        result.push(...(this._saves.get(match['save']) ?? []));
      } else if (this.canProcess() && (match = this.matchDirective(trimmedLine, DIRECTIVES_REGEX.INCLUDE)) != null) {
        const includeFile = trimmedLine.split(' ').slice(1).join(' ').slice(1, -1);

        for (const includePath of this._includePaths) {
          const path = resolve(includePath, includeFile + '.jsonui');

          if (path in Preprocessor._cachedPathPreprocessors) {
            for (const define of Preprocessor._cachedPathPreprocessors[path].getContext().getDefines()) {
              this._context.add(define);
            }
            continue;
          }

          if (!existsSync(path)) continue;

          const tempPreprocessor = new Preprocessor(this._parentContext, this._includePaths);
          tempPreprocessor.process(Deno.readTextFileSync(path));
          for (const define of tempPreprocessor.getContext().getDefines()) {
            this._context.add(define);
          }
          Preprocessor._cachedPathPreprocessors[path] = tempPreprocessor;
        }
      } else if (this.canProcess()) {
        if (lines[i].trim().length === 0) {
          if (result.length > 0 && result[result.length - 1] != '') result.push('');
          continue;
        }
        const processedLine = this.processLine(lines[i]);
        if (this._currentSave != null) {
          this._saves.get(this._currentSave)?.push(processedLine);
        }
        result.push(processedLine);
      }
    }

    return [
      true,
      result
        .join('\n')
        .replace(/,(?=[\n\r ]*(\]|\}))/gm, '')
        .replace(/\n\n\n/gm, '\n\n')
        .replace(/}\s*\n\s*\n\s*}/gm, '}\n}')
    ];
  }
}

function isMCPEVersion(value: string) {
  return value.match(MCPE_VERSION_REGEX) != null;
}

function getMCPEVersion(value: string) {
  const result = {
    major: 0,
    minor: 0,
    patch: 0
  };
  const match = value.match(MCPE_VERSION_REGEX);
  if (match == null) return result;
  result.major = Number(match.groups!['major']);
  result.minor = Number(match.groups!['minor']);
  result.patch = Number(match.groups!['patch']) ?? 0;
  return result;
}

function getMCPEVersionNumerically(value: string) {
  const match = value.match(MCPE_VERSION_REGEX);
  if (match == null) return -1;
  const major = match.groups!['major'];
  const minor = match.groups!['minor'];
  const patch = match.groups!['patch'] ?? 0;
  return Number(`${major}`.padStart(3, '0') + `${minor}`.padStart(3, '0') + `${patch}`.padStart(3, '0'));
}

if (import.meta.main) {
  const settings = Deno.args.length > 0 ? JSON.parse(Deno.args[0]) : {};

  const context = new DefineContext(undefined, () => {
    if (isMCPEVersion(name)) {
      return [true, createDefine(name, getMCPEVersionNumerically(name))];
    }
    return [false, undefined];
  });

  const targetVersion = 'target_version' in settings ? settings['target_version'] : 'MCPE_0_0';
  const targetMCPEVersion = getMCPEVersion(targetVersion);

  const preprocessor = new Preprocessor(context, 'include_paths' in settings && Array.isArray(settings['include_paths']) ? settings['include_paths'] : []);
  context.add(createDefine('MCPE_CURRENT', getMCPEVersionNumerically(targetVersion)));
  context.add(createDefine('MCPE_CURRENT_MAJOR', targetMCPEVersion.major));
  context.add(createDefine('MCPE_CURRENT_MINOR', targetMCPEVersion.minor));
  context.add(createDefine('MCPE_CURRENT_PATCH', targetMCPEVersion.patch));

  for (const pack of ['./BP', './RP']) {
    if (!existsSync(pack)) continue;

    for (const file of walkSync(pack, { includeDirs: false })) {
      const content = Deno.readTextFileSync(file.path);
      const [success, result] = preprocessor.process(content);

      if (success) {
        let res = result;
        if (file.path.endsWith('.jsonui')) {
          Deno.removeSync(file.path);
          res = translateToJson(result);
        }
        Deno.writeTextFileSync(file.path.replace('.jsonui', '.json'), res);
      }
    }
  }
}
