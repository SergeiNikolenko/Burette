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
  const start = code.indexOf("function craftInvokerFunction(");
  const end = code.indexOf("var __embind_register_class_constructor", start);
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
