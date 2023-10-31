import { TxnGroupDebugSession } from './debugRequestHandlers';

import { promises as fs } from 'fs';
import * as path from 'path';
import * as Net from 'net';
import { FileAccessor, TEALDebuggingAssets } from './utils';

/*
 * debugAdapter.js is the entrypoint of the debug adapter when it runs as a separate process.
 */

/*
 * Since here we run the debug adapter as a separate ("external") process, it has no access to VS Code API.
 * So we can only use node.js API for accessing files.
 */
const fsAccessor: FileAccessor = {
  isWindows: process.platform === 'win32',
  readFile(path: string): Promise<Uint8Array> {
    return fs.readFile(path);
  },
  writeFile(path: string, contents: Uint8Array): Promise<void> {
    return fs.writeFile(path, contents);
  },
};

async function run() {
  /*
   * When the debug adapter is run as an external process,
   * normally the helper function DebugSession.run(...) takes care of everything:
   *
   * 	MockDebugSession.run(MockDebugSession);
   *
   * but here the helper is not flexible enough to deal with a debug session constructors with a parameter.
   * So for now we copied and modified the helper:
   */

  // first parse command line arguments to see whether the debug adapter should run as a server
  let port = 0;
  const simulateResponsePath = process.env.ALGORAND_SIMULATION_RESPONSE_PATH;
  const txnGroupSourcesDescriptionPath =
    process.env.ALGORAND_TXN_GROUP_SOURCES_DESCRIPTION_PATH;

  const args = process.argv.slice(2);
  args.forEach(function (val, index, array) {
    const portMatch = /^--server=(\d{4,5})$/.exec(val);
    if (portMatch) {
      port = parseInt(portMatch[1], 10);
    }
  });

  if (typeof simulateResponsePath === 'undefined') {
    throw new Error('missing ALGORAND_SIMULATION_RESPONSE_PATH');
  }
  if (typeof txnGroupSourcesDescriptionPath === 'undefined') {
    throw new Error('missing ALGORAND_TXN_GROUP_SOURCES_DESCRIPTION_PATH');
  }

  const assets = await TEALDebuggingAssets.loadFromFiles(
    fsAccessor,
    path.resolve(simulateResponsePath),
    path.resolve(txnGroupSourcesDescriptionPath),
  );

  if (port > 0) {
    // start a server that creates a new session for every connection request
    console.error(`waiting for debug protocol on port ${port}`);
    const server = Net.createServer((socket) => {
      console.log('>> accepted connection from client');
      socket.on('error', (err) => {
        throw err;
      });
      socket.on('end', () => {
        console.error('>> client connection closed\n');
      });
      const session = new TxnGroupDebugSession(fsAccessor, assets);
      session.setRunAsServer(true);
      session.start(socket, socket);
    }).listen(port);
    server.on('error', (err) => {
      throw err;
    });
  } else {
    // start a single session that communicates via stdin/stdout
    const session = new TxnGroupDebugSession(fsAccessor, assets);
    process.on('SIGTERM', () => {
      session.shutdown();
    });
    session.start(process.stdin, process.stdout);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
