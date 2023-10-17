import * as assert from 'assert';
import * as path from 'path';
import * as algosdk from 'algosdk';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DebugClient } from './client';
import { TEALDebuggingAssets, ByteArrayMap } from '../src/debugAdapter/utils';
import { BasicServer } from '../src/debugAdapter/basicServer';
import {
	TestFixture,
	assertVariables,
	advanceTo,
	testFileAccessor,
	DATA_ROOT,
	DEBUG_CLIENT_PATH,
} from './testing';

describe('Debug Adapter Tests', () => {
	const fixture = new TestFixture();

	afterEach(async () => {
		await fixture.reset();
	});

	describe('general', () => {

		beforeEach(async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'app-state-changes/local-simulate-response.json'),
				path.join(DATA_ROOT, 'app-state-changes/sources.json')
			);
		});

		describe('basic', () => {
			it('should produce error for unknown request', async () => {
				let success: boolean;
				try {
					await fixture.client.send('illegal_request');
					success = true;
				} catch (err) {
					success = false;
				}
				assert.strictEqual(success, false);
			});
		});

		describe('initialize', () => {

			it('should return supported features', () => {
				return fixture.client.initializeRequest().then(response => {
					response.body = response.body || {};
					assert.strictEqual(response.body.supportsConfigurationDoneRequest, true);
				});
			});

			it('should produce error for invalid \'pathFormat\'', async () => {
				let success: boolean;
				try {
					await fixture.client.initializeRequest({
						adapterID: 'teal',
						linesStartAt1: true,
						columnsStartAt1: true,
						pathFormat: 'url'
					});
					success = true;
				} catch (err) {
					success = false;
				}
				assert.strictEqual(success, false);
			});
		});

		describe('launch', () => {

			it('should run program to the end', async () => {
				const PROGRAM = path.join(DATA_ROOT, 'app-state-changes/local-simulate-response.json');

				await Promise.all([
					fixture.client.configurationSequence(),
					fixture.client.launch({ program: PROGRAM }),
					fixture.client.waitForEvent('terminated')
				]);
			});

			it('should stop on entry', async () => {
				const PROGRAM = path.join(DATA_ROOT, 'app-state-changes/local-simulate-response.json');
				const ENTRY_LINE = 2;

				await Promise.all([
					fixture.client.configurationSequence(),
					fixture.client.launch({ program: PROGRAM, stopOnEntry: true }),
					fixture.client.assertStoppedLocation('entry', { line: ENTRY_LINE } )
				]);
			});
		});

		describe('setBreakpoints', () => {

			it('should stop on a breakpoint', async () => {

				const PROGRAM = path.join(DATA_ROOT, 'app-state-changes/state-changes.teal');
				const BREAKPOINT_LINE = 2;

				await fixture.client.hitBreakpoint({ program: PROGRAM }, { path: PROGRAM, line: BREAKPOINT_LINE });
			});
		});
	});

	describe('Controls', () => {
		interface Location {
			program?: string,
			name: string,
			line: number,
			column: number,
		}

		describe('Step in', () => {
			it('should pause at the correct locations', async () => {
				const simulateTracePath = path.join(DATA_ROOT, 'stepping-test/simulate-response.json');
				await fixture.init(
					simulateTracePath,
					path.join(DATA_ROOT, 'stepping-test/sources.json')
				);
				const { client } = fixture;

				await Promise.all([
					client.configurationSequence(),
					client.launch({ program: simulateTracePath, stopOnEntry: true }),
					client.assertStoppedLocation('entry', {})
				]);

				const lsigPath = path.join(DATA_ROOT, 'stepping-test/lsig.teal');
				const appPath = path.join(DATA_ROOT, 'stepping-test/app.teal');
				const expectedLocations: Location[] = [
					{
						name: "transaction-group-0.json",
						line: 2,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 18,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 19,
						column: 0
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 2,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 3,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 4,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 5,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 6,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 7,
						column: 1
					},
					{
						name: "transaction-group-0.json",
						line: 23,
						column: 0
					},
					{
						program: appPath,
						name: "app.teal",
						line: 2,
						column: 1
					},
					{
						program: appPath,
						name: "app.teal",
						line: 3,
						column: 1
					},
					{
						program: appPath,
						name: "app.teal",
						line: 5,
						column: 1
					},
					{
						program: appPath,
						name: "app.teal",
						line: 12,
						column: 1
					},
					{
						program: appPath,
						name: "app.teal",
						line: 13,
						column: 1
					},
					{
						program: appPath,
						name: "app.teal",
						line: 14,
						column: 1
					},
					{
						program: appPath,
						name: "app.teal",
						line: 8,
						column: 1
					},
					{
						program: appPath,
						name: "app.teal",
						line: 9,
						column: 1
					},
					{
						name: "transaction-group-0.json",
						line: 33,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 34,
						column: 0
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 2,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 3,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 4,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 5,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 6,
						column: 1
					},
					{
						program: lsigPath,
						name: "lsig.teal",
						line: 7,
						column: 1
					},
				];

				for (let i = 0; i < expectedLocations.length; i++) {
					const expectedLocation = expectedLocations[i];
					const stackTraceResponse = await client.stackTraceRequest({ threadId: 1 });
					const currentFrame = stackTraceResponse.body.stackFrames[0];
					const actualLocation: Location = {
						name: currentFrame.source?.name!,
						line: currentFrame.line,
						column: currentFrame.column,
					};
					if (currentFrame.source?.path) {
						actualLocation.program = currentFrame.source.path;
					}
					assert.deepStrictEqual(actualLocation, expectedLocation);

					// Move to next location
					await client.stepInRequest({ threadId: 1 });
					if (i + 1 < expectedLocations.length) {
						const stoppedEvent = await client.waitForStop();
						assert.strictEqual(stoppedEvent.body.reason, 'step');
					} else {
						await client.waitForEvent('terminated');
					}
				}
			});
		});

		describe('Step over', () => {
			it('should pause at the correct locations', async () => {
				const simulateTracePath = path.join(DATA_ROOT, 'stepping-test/simulate-response.json');
				await fixture.init(
					simulateTracePath,
					path.join(DATA_ROOT, 'stepping-test/sources.json')
				);
				const { client } = fixture;

				await Promise.all([
					client.configurationSequence(),
					client.launch({ program: simulateTracePath, stopOnEntry: true }),
					client.assertStoppedLocation('entry', {})
				]);

				const expectedLocations: Location[] = [
					{
						name: "transaction-group-0.json",
						line: 2,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 18,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 19,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 23,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 33,
						column: 0
					},
					{
						name: "transaction-group-0.json",
						line: 34,
						column: 0
					},
				];

				for (let i = 0; i < expectedLocations.length; i++) {
					const expectedLocation = expectedLocations[i];
					const stackTraceResponse = await client.stackTraceRequest({ threadId: 1 });
					const currentFrame = stackTraceResponse.body.stackFrames[0];
					const actualLocation: Location = {
						name: currentFrame.source?.name!,
						line: currentFrame.line,
						column: currentFrame.column,
					};
					if (currentFrame.source?.path) {
						actualLocation.program = currentFrame.source.path;
					}
					assert.deepStrictEqual(actualLocation, expectedLocation);

					// Move to next location
					await client.nextRequest({ threadId: 1 });
					if (i + 1 < expectedLocations.length) {
						const stoppedEvent = await client.waitForStop();
						assert.strictEqual(stoppedEvent.body.reason, 'step');
					} else {
						await client.waitForEvent('terminated');
					}
				}
			});
		});
	});

	describe('Stack and scratch changes', () => {
		it('should return variables correctly', async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'stack-scratch/simulate-response.json'),
				path.join(DATA_ROOT, 'stack-scratch/sources.json')
			);

			const { client } = fixture;
			const PROGRAM = path.join(DATA_ROOT, 'stack-scratch/stack-scratch.teal');

			await client.hitBreakpoint({ program: PROGRAM }, { path: PROGRAM, line: 3 });

			await assertVariables(client, {
				pc: 6,
				stack: [
					1005
				],
				scratch: new Map(),
			});

			await advanceTo(client, { program: PROGRAM, line: 12 });

			await assertVariables(client, {
				pc: 18,
				stack: [
					10
				],
				scratch: new Map(),
			});

			await advanceTo(client, { program: PROGRAM, line: 22 });

			await assertVariables(client, {
				pc: 34,
				stack: [
					10,
					0,
					0,
					0,
					0,
					0,
					0,
				],
				scratch: new Map(),
			});

			await advanceTo(client, { program: PROGRAM, line: 35 });

			await assertVariables(client, {
				pc: 63,
				stack: [
					10,
					30,
					Buffer.from("1!"),
					Buffer.from("5!"),
				],
				scratch: new Map(),
			});

			await advanceTo(client, { program: PROGRAM, line: 36 });

			await assertVariables(client, {
				pc: 80,
				stack: [
					10,
					30,
					Buffer.from("1!"),
					Buffer.from("5!"),
					0,
					2,
					1,
					1,
					5,
					BigInt('18446744073709551615')
				],
				scratch: new Map(),
			});

			await advanceTo(client, { program: PROGRAM, line: 37 });

			await assertVariables(client, {
				pc: 82,
				stack: [
					10,
					30,
					Buffer.from("1!"),
					Buffer.from("5!"),
					0,
					2,
					1,
					1,
					5,
				],
				scratch: new Map([
					[
						1,
						BigInt('18446744073709551615')
					],
				]),
			});

			await advanceTo(client, { program: PROGRAM, line: 39 });

			await assertVariables(client, {
				pc: 85,
				stack: [
					10,
					30,
					Buffer.from("1!"),
					Buffer.from("5!"),
					0,
					2,
					1,
					1,
				],
				scratch: new Map([
					[
						1,
						BigInt('18446744073709551615')
					],
					[
						5,
						BigInt('18446744073709551615')
					],
				]),
			});

			await advanceTo(client, { program: PROGRAM, line: 41 });

			await assertVariables(client, {
				pc: 89,
				stack: [
					10,
					30,
					Buffer.from("1!"),
					Buffer.from("5!"),
					0,
					2,
					1,
					1,
				],
				scratch: new Map([
					[
						1,
						BigInt('18446744073709551615')
					],
					[
						5,
						BigInt('18446744073709551615')
					],
				]),
			});

			await advanceTo(client, { program: PROGRAM, line: 13 });

			await assertVariables(client, {
				pc: 21,
				stack: [
					30,
				],
				scratch: new Map([
					[
						1,
						BigInt('18446744073709551615')
					],
					[
						5,
						BigInt('18446744073709551615')
					],
				]),
			});
		});
	});

	describe('Global state changes', () => {
		it('should return variables correctly', async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'app-state-changes/global-simulate-response.json'),
				path.join(DATA_ROOT, 'app-state-changes/sources.json')
			);
			
			const { client } = fixture;
			const PROGRAM = path.join(DATA_ROOT, 'app-state-changes/state-changes.teal');

			await client.hitBreakpoint({ program: PROGRAM }, { path: PROGRAM, line: 3 });

			await assertVariables(client, {
				pc: 6,
				stack: [
					1050
				],
				apps: [{
					appID: 1050,
					globalState: new ByteArrayMap()
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 14 });

			await assertVariables(client, {
				pc: 37,
				stack: [
					Buffer.from('8e169311', 'hex'),
					Buffer.from('8913c1f8', 'hex'),
					Buffer.from('d513c44e', 'hex'),
					Buffer.from('8913c1f8', 'hex'),
				],
				apps: [{
					appID: 1050,
					globalState: new ByteArrayMap()
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 31 });

			await assertVariables(client, {
				pc: 121,
				stack: [
					Buffer.from('global-int-key'),
					0xdeadbeef,
				],
				apps: [{
					appID: 1050,
					globalState: new ByteArrayMap()
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 32 });

			await assertVariables(client, {
				pc: 122,
				stack: [],
				apps: [{
					appID: 1050,
					globalState: new ByteArrayMap([
						[
							Buffer.from('global-int-key'),
							0xdeadbeef,
						],
					])
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 35 });

			await assertVariables(client, {
				pc: 156,
				stack: [],
				apps: [{
					appID: 1050,
					globalState: new ByteArrayMap<number | bigint | Uint8Array>([
						[
							Buffer.from('global-int-key'),
							0xdeadbeef,
						],
						[
							Buffer.from('global-bytes-key'),
							Buffer.from('welt am draht'),
						]
					])
				}],
			});
		});
	});

	describe('Local state changes', () => {
		it('should return variables correctly', async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'app-state-changes/local-simulate-response.json'),
				path.join(DATA_ROOT, 'app-state-changes/sources.json')
			);

			const { client } = fixture;
			const PROGRAM = path.join(DATA_ROOT, 'app-state-changes/state-changes.teal');

			await client.hitBreakpoint({ program: PROGRAM }, { path: PROGRAM, line: 3 });

			await assertVariables(client, {
				pc: 6,
				stack: [
					1054
				],
				apps: [{
					appID: 1054,
					localState: [{
						account: 'YGOSQB6R5IVQDJHJUHTIZAJNWNIT7VLMWHXFWY2H5HMWPK7QOPXHELNPJ4',
						state: new ByteArrayMap(),
					}],
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 14 });

			await assertVariables(client, {
				pc: 37,
				stack: [
					Buffer.from('8e169311', 'hex'),
					Buffer.from('8913c1f8', 'hex'),
					Buffer.from('d513c44e', 'hex'),
					Buffer.from('8e169311', 'hex'),
				],
				apps: [{
					appID: 1054,
					localState: [{
						account: 'YGOSQB6R5IVQDJHJUHTIZAJNWNIT7VLMWHXFWY2H5HMWPK7QOPXHELNPJ4',
						state: new ByteArrayMap(),
					}],
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 21 });

			await assertVariables(client, {
				pc: 69,
				stack: [
					algosdk.decodeAddress('YGOSQB6R5IVQDJHJUHTIZAJNWNIT7VLMWHXFWY2H5HMWPK7QOPXHELNPJ4').publicKey,
					Buffer.from('local-int-key'),
					0xcafeb0ba,
				],
				apps: [{
					appID: 1054,
					localState: [{
						account: 'YGOSQB6R5IVQDJHJUHTIZAJNWNIT7VLMWHXFWY2H5HMWPK7QOPXHELNPJ4',
						state: new ByteArrayMap(),
					}],
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 22 });

			await assertVariables(client, {
				pc: 70,
				stack: [],
				apps: [{
					appID: 1054,
					localState: [{
						account: 'YGOSQB6R5IVQDJHJUHTIZAJNWNIT7VLMWHXFWY2H5HMWPK7QOPXHELNPJ4',
						state: new ByteArrayMap([
							[
								Buffer.from('local-int-key'),
								0xcafeb0ba,
							],
						]),
					}],
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 26 });

			await assertVariables(client, {
				pc: 96,
				stack: [],
				apps: [{
					appID: 1054,
					localState: [{
						account: 'YGOSQB6R5IVQDJHJUHTIZAJNWNIT7VLMWHXFWY2H5HMWPK7QOPXHELNPJ4',
						state: new ByteArrayMap<number | bigint | Uint8Array>([
							[
								Buffer.from('local-int-key'),
								0xcafeb0ba,
							],
							[
								Buffer.from('local-bytes-key'),
								Buffer.from('xqcL'),
							],
						]),
					}],
				}],
			});
		});
	});

	describe('Box state changes', () => {
		it('should return variables correctly', async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'app-state-changes/box-simulate-response.json'),
				path.join(DATA_ROOT, 'app-state-changes/sources.json')
			);

			const { client } = fixture;
			const PROGRAM = path.join(DATA_ROOT, 'app-state-changes/state-changes.teal');

			await client.hitBreakpoint({ program: PROGRAM }, { path: PROGRAM, line: 3 });

			await assertVariables(client, {
				pc: 6,
				stack: [
					1058
				],
				apps: [{
					appID: 1058,
					boxState: new ByteArrayMap()
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 14 });

			await assertVariables(client, {
				pc: 37,
				stack: [
					Buffer.from('8e169311', 'hex'),
					Buffer.from('8913c1f8', 'hex'),
					Buffer.from('d513c44e', 'hex'),
					Buffer.from('d513c44e', 'hex'),
				],
				apps: [{
					appID: 1058,
					boxState: new ByteArrayMap()
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 40 });

			await assertVariables(client, {
				pc: 183,
				stack: [
					Buffer.from('box-key-1'),
					Buffer.from('box-value-1'),
				],
				apps: [{
					appID: 1058,
					boxState: new ByteArrayMap()
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 41 });

			await assertVariables(client, {
				pc: 184,
				stack: [],
				apps: [{
					appID: 1058,
					boxState: new ByteArrayMap([
						[
							Buffer.from('box-key-1'),
							Buffer.from('box-value-1'),
						],
					])
				}],
			});

			await advanceTo(client, { program: PROGRAM, line: 46 });

			await assertVariables(client, {
				pc: 198,
				stack: [],
				apps: [{
					appID: 1058,
					boxState: new ByteArrayMap([
						[
							Buffer.from('box-key-1'),
							Buffer.from('box-value-1'),
						],
						[
							Buffer.from('box-key-2'),
							Buffer.from(''),
						]
					])
				}],
			});
		});
	});

	describe('Source mapping', () => {
		interface SourceInfo {
			path: string,
			validBreakpoints: DebugProtocol.BreakpointLocation[],
		}

		const testSources: SourceInfo[] = [
			{
				path: path.join(DATA_ROOT, 'sourcemap-test/sourcemap-test.teal'),
				validBreakpoints: [
					{ line: 4, column: 1 },
					{ line: 4, column: 20 },
					{ line: 4, column: 27 },
					{ line: 4, column: 31 },
					{ line: 7, column: 5 },
					{ line: 7, column: 12 },
					{ line: 7, column: 19 },
					{ line: 8, column: 5 },
					{ line: 8, column: 12 },
					{ line: 8, column: 19 },
					{ line: 12, column: 5 },
					{ line: 13, column: 5 },
				]
			},
			{
				path: path.join(DATA_ROOT, 'sourcemap-test/lib.teal'),
				validBreakpoints: [
					{ line: 2, column: 22 },
					{ line: 2, column: 26 },
				]
			},
		];

		it('should return correct breakpoint locations', async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'sourcemap-test/simulate-response.json'),
				path.join(DATA_ROOT, 'sourcemap-test/sources.json')
			);

			const { client } = fixture;

			for (const source of testSources) {
				const response = await client.breakpointLocationsRequest({
					source: {
						path: source.path,
					},
					line: 0,
					endLine: 100,
				});
				assert.ok(response.success);
				
				const actualBreakpointLocations = response.body.breakpoints.slice();
				// Sort the response so that it's easier to compare
				actualBreakpointLocations.sort((a, b) => {
					if (a.line === b.line) {
						return (a.column ?? 0) - (b.column ?? 0);
					}
					return a.line - b.line;
				});
	
				assert.deepStrictEqual(actualBreakpointLocations, source.validBreakpoints);
			}
		});

		it('should correctly set and stop at valid breakpoints', async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'sourcemap-test/simulate-response.json'),
				path.join(DATA_ROOT, 'sourcemap-test/sources.json')
			);

			const { client } = fixture;

			await Promise.all([
				client.configurationSequence(),
				client.launch({
					program: path.join(DATA_ROOT, 'sourcemap-test/simulate-response.json'),
					stopOnEntry: true
				}),
				client.assertStoppedLocation('entry', {})
			]);

			for (const source of testSources) {
				const result = await client.setBreakpointsRequest({
					source: { path: source.path },
					breakpoints: source.validBreakpoints, 
				});
				assert.ok(result.success);

				assert.ok(result.body.breakpoints.every(bp => bp.verified));
				const actualBreakpointLocations = result.body.breakpoints
					.map(bp => ({ line: bp.line, column: bp.column }));
				assert.deepStrictEqual(actualBreakpointLocations, source.validBreakpoints);
			}

			// The breakpoints will not necessarily be hit in order, since PCs map to different
			// places in the source file, so we will keep track of which breakpoints have been hit.
			const seenBreakpointLocation: boolean[][] = testSources.map(source => source.validBreakpoints.map(() => false));

			while (seenBreakpointLocation.some(sourceBreakpoints => sourceBreakpoints.some(seen => !seen))) {
				await client.continueRequest({ threadId: 1 });
				const stoppedResponse = await client.assertStoppedLocation('breakpoint', {});
				const stoppedFrame = stoppedResponse.body.stackFrames[0];
				let found = false;
				for (let sourceIndex = 0; sourceIndex < testSources.length; sourceIndex++) {
					const source = testSources[sourceIndex];
					if (source.path !== stoppedFrame.source?.path) {
						continue;
					}
					for (let i = 0; i < source.validBreakpoints.length; i++) {
						if (source.validBreakpoints[i].line === stoppedFrame.line &&
							source.validBreakpoints[i].column === stoppedFrame.column) {
							assert.strictEqual(seenBreakpointLocation[sourceIndex][i], false, `Breakpoint ${i} was hit twice. Line: ${stoppedFrame.line}, Column: ${stoppedFrame.column}, Path: ${source.path}`);
							seenBreakpointLocation[sourceIndex][i] = true;
							found = true;
							break;
						}
					}
				}
				assert.ok(found, `Breakpoint at path ${stoppedFrame.source?.path}, line ${stoppedFrame.line}, column ${stoppedFrame.column} was not expected`);
			}
		});

		it('should correctly handle invalid breakpoints and not stop at them', async () => {
			await fixture.init(
				path.join(DATA_ROOT, 'sourcemap-test/simulate-response.json'),
				path.join(DATA_ROOT, 'sourcemap-test/sources.json')
			);

			const { client } = fixture;

			await Promise.all([
				client.configurationSequence(),
				client.launch({
					program: path.join(DATA_ROOT, 'sourcemap-test/simulate-response.json'),
					stopOnEntry: true
				}),
				client.assertStoppedLocation('entry', {})
			]);

			const result = await client.setBreakpointsRequest({
				source: { path: path.join(DATA_ROOT, 'sourcemap-test/sourcemap-test.teal') },
				breakpoints: [
					{ line: 0, column: 0 },
					{ line: 100, column: 0 },
					{ line: 0, column: 100 },
					{ line: 100, column: 100 },
				],
			});
			assert.ok(result.success);

			assert.ok(result.body.breakpoints.every(bp => !bp.verified));

			await Promise.all([
				client.continueRequest({ threadId: 1 }),
				client.waitForEvent('terminated')
			]);
		});
	});
});
