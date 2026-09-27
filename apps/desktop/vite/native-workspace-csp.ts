import type { Plugin } from "vite";

// The locked Emscripten runtimes generate synchronous Embind wrappers with
// Function(). Their wire conversion/destructor semantics do not require code
// generation. Keep the substitution confined to the offline MCP build.
const invoker = `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){
  if(isAsync) throw new Error('Async Embind is not supported in this workspace.');
  if(argTypes.length<2) throwBindingError('argTypes array size mismatch!');
  var method=argTypes[1]!==null&&classType!==null;
  var stack=usesDestructorStack(argTypes);
  return createNamedFunction(humanName,function(...args){
    var destructors=stack?[]:null, wired=[cppTargetFunc], converted=[];
    for(var i=method?1:2;i<argTypes.length;i++){
      var value=argTypes[i].toWireType(destructors,i===1?this:args[i-2]);
      wired.push(value); converted.push([argTypes[i],value]);
    }
    var result=cppInvokerFunc(...wired);
    if(stack) runDestructors(destructors);
    else for(var pair of converted) if(pair[0].destructorFunction!==null) pair[0].destructorFunction(pair[1]);
    if(argTypes[0].name!=='void') return argTypes[0].fromWireType(result);
  });
}`;
const methodCaller = `function __emval_get_method_caller(argCount,argTypes,kind){
  var types=emval_lookupTypes(argCount,argTypes),retType=types.shift();
  return emval_addMethodCaller(function(obj,func,destructorsRef,args){
    var values=[],offset=0;
    for(var type of types){values.push(type.readValueFromPointer(args+offset));offset+=type.argPackAdvance;}
    var result=kind===1?Reflect.construct(func,values):func.apply(obj,values);
    if(!retType.isVoid) return emval_returnValue(retType,destructorsRef,result);
  });
}`;

export function rewriteEmbindForCsp(code: string) {
  const factoryStart = code.indexOf("function createJsInvoker(");
  if (factoryStart >= 0) {
    const factoryEnd = code.indexOf("var __embind_register_class_constructor", factoryStart);
    const callerStart = code.indexOf("var __emval_create_invoker=function(");
    const callerEnd = code.indexOf("function __emval_get_global(", callerStart);
    if (callerStart < 0) {
      const legacyStart = code.indexOf("function __emval_get_method_caller(", factoryEnd);
      const legacyEnd = code.indexOf("function __emval_get_property(", legacyStart);
      if (factoryEnd < 0 || legacyStart < 0 || legacyEnd < 0
          || !code.slice(factoryStart, factoryEnd).includes("new Function(...args,invokerFnBody)")
          || !code.slice(legacyStart, legacyEnd).includes("new Function(...params,functionBody)")) throw new Error("Intermediate Embind layout changed.");
      code = code.slice(0, legacyStart) + methodCaller + code.slice(legacyEnd);
      code = code.slice(0, factoryStart) + invoker + code.slice(factoryEnd);
      if (/\bnew\s+Function\b|\bFunction\s*\(|\beval\s*\(/u.test(code)) throw new Error("Unreviewed dynamic code in Embind runtime.");
      return code;
    }
    if (factoryEnd < 0 || callerStart < factoryEnd || callerEnd < 0
        || !code.slice(factoryStart, factoryEnd).includes("new Function(args1,invokerFnBody)")
        || !code.slice(callerStart, callerEnd).includes("var GenericWireTypeSize=8")) throw new Error("Modern Embind layout changed.");
    const modernCaller = `var __emval_create_invoker=function(argCount,argTypesPtr,kind){
      var [retType,...types]=emval_lookupTypes(argCount,argTypesPtr), toReturnWire=retType.toWireType.bind(retType);
      return emval_addMethodCaller(function(handle,methodName,destructorsRef,args){
        var values=types.map((type,index)=>type.readValueFromPointer(args+index*8)),result;
        if(kind===0) result=Emval.toValue(handle)(...values);
        else if(kind===1){var obj=Emval.toValue(handle);result=obj[getStringOrSymbol(methodName)](...values);}
        else if(kind===2) result=Reflect.construct(Emval.toValue(handle),values);
        else if(kind===3) result=values[values.length-1];
        else throw new Error('Unsupported Emval invocation kind.');
        if(!retType.isVoid) return emval_returnValue(toReturnWire,destructorsRef,result);
      });
    };`;
    code = code.slice(0, callerStart) + modernCaller + code.slice(callerEnd);
    code = code.slice(0, factoryStart) + invoker + code.slice(factoryEnd);
    if (/\bnew\s+Function\b|\bFunction\s*\(|\beval\s*\(/u.test(code)) throw new Error("Unreviewed dynamic code in Embind runtime.");
    return code;
  }
  const start = code.indexOf("function craftInvokerFunction(");
  const end = code.indexOf("var __embind_register_class_constructor", start);
  // Indigo 1.46 ships a closure-based invoker already. Preserve upstream wire
  // conversion semantics instead of replacing it or weakening the iframe CSP.
  const existing = code.slice(start, end);
  if (start >= 0 && end > start && existing.includes("var invokerFn=function(...args)")
      && existing.includes("cppInvokerFunc(...invokerFuncArgs)")
      && code.includes('createNamedFunction=(name,func)=>Object.defineProperty')
      && !/\bnew\s+Function\b|\bFunction\s*\(|\beval\s*\(|newFunc\(Function/u.test(code)) return code;
  if (start < 0 || end < 0 || !/new Function|newFunc\(Function/u.test(code.slice(start, end))) {
    throw new Error("Embind layout changed; review the offline workspace build.");
  }
  code = code.slice(0, start) + invoker + code.slice(end);
  const callerStart = code.indexOf("function __emval_get_method_caller(");
  if (callerStart >= 0) {
    const callerEnd = code.indexOf("function __emval_get_property(", callerStart);
    if (callerEnd < 0 || !code.slice(callerStart, callerEnd).includes("new Function")) throw new Error("Emval layout changed.");
    code = code.slice(0, callerStart) + methodCaller + code.slice(callerEnd);
  }
  return code;
}

export function nativeWorkspaceCspPlugin(): Plugin {
  return {
    name: "burette-native-workspace-csp", enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/paper/dist/paper-full.js")) {
        const start = code.indexOf("function makePredicate(words)");
        const end = code.indexOf("var isReservedWord3", start);
        if (start < 0 || end < 0 || !code.slice(start, end).includes('new Function("str", f)')) throw new Error("Paper keyword parser changed.");
        return { code: code.slice(0, start) + "function makePredicate(words){const set=new Set(words.split(' '));return str=>set.has(str);}\n" + code.slice(end), map: null };
      }
      if (id.endsWith("/RDKit_minimal.js") || /ketcher-standalone\/dist\/binaryWasm\/indigoWorker-[^/]+\.js$/u.test(id)) {
        return { code: rewriteEmbindForCsp(code), map: null };
      }
      return null;
    },
  };
}
