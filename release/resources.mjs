import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const nodeVersion = '25.8.1';
export const platforms = {
  'win32-x64': {
    name: 'windows-x64',
    launcher: 'Bang.cmd',
    packageExtension: '.zip',
    archive: 'node-v25.8.1-win-x64.zip',
    archiveSha256: '09a5a0dbb2f4cefa800880012810e2dfaac0016a62e75f064c4ab7f3606b2d78',
    archiveRoot: 'node-v25.8.1-win-x64',
    node: 'node.exe',
    npm: 'node_modules/npm/bin/npm-cli.js',
    helpers: {
      'lock-host.exe': '9127e4917168cd753cb04a5606db24f6bbdb222343a15498b8a6d45449fdd16c',
      'process-host.exe': '4af1c4ab8344bfab690fccad2588496c87de6415c90d516592bb191b2ac00dbd',
    },
  },
  'linux-x64': {
    name: 'linux-x64',
    launcher: 'bang',
    packageExtension: '.tar.gz',
    archive: 'node-v25.8.1-linux-x64.tar.xz',
    archiveSha256: '8c13c85f73b1f8e57d5fff0732b3f25880910aafa6d5c811073a2ec7fcd45b4c',
    archiveRoot: 'node-v25.8.1-linux-x64',
    node: 'bin/node',
    npm: 'lib/node_modules/npm/bin/npm-cli.js',
    helpers: {
      'lock-host': '37911f69f2c447131d253f745b028b303a60d287919c4fd857f33145c288d50d',
      'process-host': '22c0d7ec82f98d43e418ba8c0fd0491d1703c55a2dd1cad450764383a5fb5ec5',
    },
  },
};

export function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function regularFile(file) {
  return fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

export function inventory(root, directory = root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return inventory(root, absolute);
    if (!entry.isFile()) throw Error('Installation resources must be regular files');
    return [path.relative(root, absolute).split(path.sep).join('/')];
  }).sort();
}
