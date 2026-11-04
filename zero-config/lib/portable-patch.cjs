'use strict';

function patchConfigDirectory(source, label) {
  const pattern = /function ([\w$]+)\(\)\{if\(process\.env\.CLAUDE_USER_DATA_DIR\)return ([\w$]+)\.app\.getPath\("userData"\);/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected one config-directory function, found ${matches.length}`);
  }
  return source.replace(pattern, (match, functionName, electronName) =>
    `function ${functionName}(){if(globalThis.__CLAUDE_ZERO_CONFIG_DIRECTORY__)return globalThis.__CLAUDE_ZERO_CONFIG_DIRECTORY__;if(process.env.CLAUDE_USER_DATA_DIR)return ${electronName}.app.getPath("userData");`);
}

function patchModelValidator(source, label) {
  const pattern = /function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+)=\2\.toLowerCase\(\);return [\w$]+\.test\(\3\)\?!1:[\w$]+\.test\(\3\)\|\|[\w$]+\.some\(\(\(?[\w$]+=>\3\.includes\([\w$]+\)\)?\)\)\}/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected one model-validator function, found ${matches.length}`);
  }
  return source.replace(pattern, (match, functionName, paramName) =>
    `function ${functionName}(${paramName}){return true}`);
}

module.exports = { patchConfigDirectory, patchModelValidator };
