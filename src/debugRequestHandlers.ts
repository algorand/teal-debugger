/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { basename } from 'path-browserify';
import { TxnGroupWalkerRuntime, IRuntimeBreakpoint, FileAccessor, RuntimeVariable } from './txnGroupWalkerRuntime';
import { Subject } from 'await-notify';
import * as algosdk from 'algosdk';
import { TEALDebuggingAssets, isAsciiPrintable, limitArray } from './utils';

export enum RuntimeEvents {
	stopOnEntry = 'stopOnEntry',
	stopOnStep = 'stopOnStep',
	stopOnBreakpoint = 'stopOnBreakpoint',
	breakpointValidated = 'breakpointValidated',
	end = 'end',
}

/**
 * This interface describes the teal-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the teal-debug extension.
 * The interface should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
	/** run without debugging */
	noDebug?: boolean;
	/** if specified, results in a simulated compile error in launch. */
	compileError?: 'default' | 'show' | 'hide';
}

interface IAttachRequestArguments extends ILaunchRequestArguments { }


type AvmValueScope = 'stack' | 'scratch';

export class TxnGroupDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static threadID = 1;

	// txn group walker runtime for walking txn group.
	private _runtime: TxnGroupWalkerRuntime;

	private _variableHandles = new Handles<'execution' | 'chain' | AvmValueScope | AvmValueReference>();

	private _configurationDone = new Subject();

	private _valuesInHex = false;

	private _addressesInHex = true;

	private _debugAssets: TEALDebuggingAssets;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor(fileAccessor: FileAccessor, debugAssets?: TEALDebuggingAssets) {
		super("mock-debug.txt");

		this._debugAssets = <TEALDebuggingAssets>debugAssets;

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);

		this._runtime = new TxnGroupWalkerRuntime(fileAccessor, this._debugAssets);

		// setup event handlers
		this._runtime.on(RuntimeEvents.stopOnEntry, () => {
			this.sendEvent(new StoppedEvent('entry', TxnGroupDebugSession.threadID));
		});
		this._runtime.on(RuntimeEvents.stopOnStep, () => {
			this.sendEvent(new StoppedEvent('step', TxnGroupDebugSession.threadID));
		});
		this._runtime.on(RuntimeEvents.stopOnBreakpoint, () => {
			this.sendEvent(new StoppedEvent('breakpoint', TxnGroupDebugSession.threadID));
		});
		this._runtime.on(RuntimeEvents.breakpointValidated, (bp: IRuntimeBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', { verified: bp.verified, id: bp.id } as DebugProtocol.Breakpoint));
		});
		this._runtime.on(RuntimeEvents.end, () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDone request.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code show a 'step back' button
		response.body.supportsStepBack = true;

		// make VS Code send cancel request
		response.body.supportsCancelRequest = false;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = true;

		// TEAL is not so thready.
		response.body.supportsSingleThreadExecutionRequests = false;
		response.body.supportsTerminateThreadsRequest = false;

		// the adapter defines two exceptions filters, one with support for conditions.
		response.body.supportsExceptionFilterOptions = true;
		response.body.exceptionBreakpointFilters = [
			{
				filter: 'namedException',
				label: "Named Exception",
				description: `Break on named exceptions. Enter the exception's name as the Condition.`,
				default: false,
				supportsCondition: true,
				conditionDescription: `Enter the exception's name`
			},
			{
				filter: 'otherExceptions',
				label: "Other Exceptions",
				description: 'This is a other exception',
				default: true,
				supportsCondition: false
			}
		];

		// make VS Code send exceptionInfo request
		// response.body.supportsExceptionInfoRequest = true;

		// make VS Code send setVariable request
		// response.body.supportsSetVariable = true;

		// make VS Code send setExpression request
		// response.body.supportsSetExpression = true;

		// make VS Code send disassemble request
		// response.body.supportsDisassembleRequest = true;
		// response.body.supportsSteppingGranularity = true;
		// response.body.supportsInstructionBreakpoints = true;

		// make VS Code able to read and write variable memory
		// response.body.supportsReadMemoryRequest = true;
		// response.body.supportsWriteMemoryRequest = true;

		response.body.supportSuspendDebuggee = true;
		response.body.supportTerminateDebuggee = true;
		// response.body.supportsFunctionBreakpoints = true;
		response.body.supportsDelayedStackTraceLoading = true;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
		console.log(`disconnectRequest suspend: ${args.suspendDebuggee}, terminate: ${args.terminateDebuggee}`);
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: IAttachRequestArguments) {
		return this.launchRequest(response, args);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// wait 1 second until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone.wait(1000);

		// start the program in the runtime
		await this._runtime.start(!!args.stopOnEntry, !args.noDebug);

		this.sendResponse(response);
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {

		const path = args.source.path as string;
		const clientLines = args.lines || [];

		// clear all breakpoints for this file
		this._runtime.clearBreakpoints(path);

		// set and verify breakpoint locations
		const actualBreakpoints0 = clientLines.map(async l => {
			const { verified, line, id } = await this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = new Breakpoint(verified, this.convertDebuggerLineToClient(line)) as DebugProtocol.Breakpoint;
			bp.id = id;
			return bp;
		});
		const actualBreakpoints = await Promise.all<DebugProtocol.Breakpoint>(actualBreakpoints0);

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
		// TODO: shouldn't this get the breakpoints from this._runtime?
		if (args.source.path) {
			response.body = {
				breakpoints: [{ line: args.line, }]
			};
		} else {
			response.body = {
				breakpoints: []
			};
		}
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(TxnGroupDebugSession.threadID, "thread 1"),
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;

		const stk = this._runtime.stack(startFrame, endFrame);

		response.body = {
			stackFrames: stk.frames.map((f, ix) => {
				const sf: DebugProtocol.StackFrame = new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line));
				return sf;
			}),
			// 4 options for 'totalFrames':
			//omit totalFrames property: 	// VS Code has to probe/guess. Should result in a max. of two requests
			// totalFrames: stk.count			// stk.count is the correct size, should result in a max. of two requests
			//totalFrames: 1000000 			// not the correct size, should result in a max. of two requests
			//totalFrames: endFrame + 20 	// dynamically increases the size with every requested chunk, results in paging
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		response.body = {
			scopes: [
				new Scope("Execution State", this._variableHandles.create('execution'), false),
				new Scope("On-chain State", this._variableHandles.create('chain'), false),
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): Promise<void> {
		let variables: DebugProtocol.Variable[] = [];

		const v = this._variableHandles.get(args.variablesReference);
		// if (v === 'scratches') {
		// 	const vs = this._runtime.getScratchVariables();
		// 	variables = vs.map(v => this.convertFromRuntime(v));
		// } else if (v === 'stacks') {
		// 	const stackValues = this._runtime.getStackValues();
		// 	variables = this.convertStackValues(stackValues);
		// } else if (v === 'app') {
		// 	// TODO
		// } else if (v && Array.isArray(v.value)) {
		// 	variables = v.value.map(v => this.convertFromRuntime(v));
		// }

		if (v === 'execution') {
			const stackValues = this._runtime.getStackValues();
			variables = [
				{
					name: 'stack',
					value: stackValues.length === 0 ? '[]' : '[...]',
					type: 'array',
					variablesReference: this._variableHandles.create('stack'),
					namedVariables: 1,
					indexedVariables: stackValues.length,
					presentationHint: {
						kind: 'data',
					},
				},
				{
					name: 'scratch',
					value: '[...]',
					type: 'array',
					variablesReference: this._variableHandles.create('scratch'),
					indexedVariables: 256,
					presentationHint: {
						kind: 'data',
					},
				}
			];
		} else if (v === 'chain') {
			// variables = [{
			// 	name: 'App State',
			// 	value: '[...]',
			// 	type: 'object',
			// 	variablesReference: this._variableHandles.create('app'),
			// }];
		} else if (v === 'stack') {
			const stackValues = this._runtime.getStackValues();
			if (args.filter !== 'named') {
				variables = stackValues.map((value, index) => this.convertAvmValue('stack', value, index));
				variables = limitArray(variables, args.start, args.count);
			}
		} else if (v === 'scratch') {
			const scratchValues = this._runtime.getScratchValues();
			if (args.filter !== 'named') {
				variables = scratchValues.map((value, index) => this.convertAvmValue('scratch', value, index));
				variables = limitArray(variables, args.start, args.count);
			}
		} else if (v instanceof AvmValueReference) {
			let toExpand: algosdk.modelsv2.AvmValue;
			if (v.scope === 'stack') {
				const stackValues = this._runtime.getStackValues();
				toExpand = stackValues[v.index];
			} else if (v.scope === 'scratch') {
				const scratchValues = this._runtime.getScratchValues();
				toExpand = scratchValues[v.index];
			} else {
				throw new Error(`Unexpected AvmValueReference scope: ${v.scope}`);
			}
			variables = this.expandAvmValue(toExpand, args.filter);
			variables = limitArray(variables, args.start, args.count);
		}

		response.body = {
			variables
		};
		this.sendResponse(response);
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
		let reply: string | undefined;
		let rv: DebugProtocol.Variable | undefined = undefined;

		// Note, can use args.context to perform different actions based on where the expression is evaluated

		const stackMatches = /^stack\[(-?\d+)\]$/.exec(args.expression);
		const scratchMatches = /^scratch\[(\d+)\]$/.exec(args.expression);

		if (stackMatches && stackMatches.length === 2) {
			let index = parseInt(stackMatches[1], 10);
			const stackValues = this._runtime.getStackValues();
			if (index < 0) {
				const adjustedIndex = index + stackValues.length;
				if (adjustedIndex < 0) {
					reply = `stack[${index}] out of range`;
				} else {
					index = adjustedIndex;
				}
			}
			if (0 <= index && index < stackValues.length) {
				rv = this.convertAvmValue('stack', stackValues[index], index);
			} else if (index < 0 && stackValues.length + index >= 0) {
				rv = this.convertAvmValue('stack', stackValues[stackValues.length + index], index);
			} else {
				reply = `stack[${index}] out of range`;
			}
		} else if (scratchMatches && scratchMatches.length === 2) {
			const index = parseInt(scratchMatches[1], 10);
			const scratchValues = this._runtime.getScratchValues();
			if (0 <= index && index < scratchValues.length) {
				rv = this.convertAvmValue('scratch', scratchValues[index], index);
			} else {
				reply = `scratch[${index}] out of range`;
			}
		}

		if (rv) {
			response.body = {
				result: rv.value,
				type: rv.type,
				variablesReference: rv.variablesReference,
				presentationHint: rv.presentationHint
			};
		} else {
			response.body = {
				result: reply || `unknown expression: "${args.expression}"`,
				variablesReference: 0
			};
		}

		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue(false);
		this.sendResponse(response);
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
		this._runtime.continue(true);
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._runtime.step(false);
		this.sendResponse(response);
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this._runtime.step(true);
		this.sendResponse(response);
	}

	protected stepInTargetsRequest(response: DebugProtocol.StepInTargetsResponse, args: DebugProtocol.StepInTargetsArguments) {
		const targets = this._runtime.getStepInTargets(args.frameId);
		response.body = {
			targets: targets.map(t => {
				return { id: t.id, label: t.label };
			})
		};
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this._runtime.stepIn(args.targetId);
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this._runtime.stepOut();
		this.sendResponse(response);
	}

	//---- helpers

	private convertAvmValue(scope: AvmValueScope, avmValue: algosdk.modelsv2.AvmValue, index: number): DebugProtocol.Variable {
		let convertedValue: string;
		let namedVariables: number | undefined = undefined;
		let indexedVariables: number | undefined = undefined;
		let variablesReference: number = 0;
		let presentationHint: DebugProtocol.VariablePresentationHint | undefined = undefined;
		if (avmValue.type === 1) {
			// byte array
			const bytes = avmValue.bytes || new Uint8Array();
			convertedValue = '0x' + Buffer.from(bytes).toString('hex');
			namedVariables = 2;
			if (isAsciiPrintable(bytes)) {
				namedVariables++;
			}
			indexedVariables = bytes.length;
			variablesReference = this._variableHandles.create(new AvmValueReference(scope, index));
			presentationHint = {
				kind: 'data',
				attributes: ['rawString'],
			};
		} else {
			// uint64
			const uint = avmValue.uint || 0;
			convertedValue = uint.toString();
		}
		return {
			name: index.toString(),
			value: convertedValue,
			type: avmValue.type === 1 ? 'byte[]' : 'uint64',
			variablesReference,
			namedVariables,
			indexedVariables,
			presentationHint,
			evaluateName: `${scope}[${index}]`,
		};
	}

	private expandAvmValue(avmValue: algosdk.modelsv2.AvmValue, filter?: DebugProtocol.VariablesArguments['filter']): DebugProtocol.Variable[] {
		if (avmValue.type !== 1) {
			return [];
		}

		const bytes = avmValue.bytes || new Uint8Array();

		const values: DebugProtocol.Variable[] = [];

		if (filter !== 'indexed') {
			let formats: BufferEncoding[] = ['hex', 'base64'];
			if (isAsciiPrintable(bytes)) {
				// TODO: perhaps do this with UTF-8 instead, see https://stackoverflow.com/questions/75108373/how-to-check-if-a-node-js-buffer-contains-valid-utf-8
				formats.push('ascii');
			}
			if (bytes.length === 0) {
				formats = [];
			}

			for (const format of formats) {
				values.push({
					name: format,
					type: 'string',
					value: Buffer.from(bytes).toString(format),
					variablesReference: 0,
				});
			}

			if (bytes.length === 32) {
				values.push({
					name: 'address',
					type: 'string',
					value: algosdk.encodeAddress(bytes),
					variablesReference: 0,
				});
			}

			values.push({
				name: 'length',
				type: 'number',
				value: bytes.length.toString(),
				variablesReference: 0,
			});
		}

		if (filter !== 'named') {
			for (let i = 0; i < bytes.length; i++) {
				values.push({
					name: i.toString(),
					type: 'uint8',
					value: bytes[i].toString(),
					variablesReference: 0,
				});
			}
		}

		return values;
	}

	private formatAddress(x: number, pad = 8) {
		return this._addressesInHex ? '0x' + x.toString(16).padStart(8, '0') : x.toString(10);
	}

	private formatNumber(x: number) {
		return this._valuesInHex ? '0x' + x.toString(16) : x.toString(10);
	}

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'teal-txn-group-adapter-data');
	}
}

class AvmValueReference {
	constructor(public readonly scope: AvmValueScope, public readonly index: number) { }
}
