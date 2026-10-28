/* Bundled CJSON rendering inside Quick Look, whose sandbox forbids process-fork.
 * Built against the pinned interpreter headers, then loads that exact runtime.
 */
#include <Python.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>

static pthread_mutex_t render_lock = PTHREAD_MUTEX_INITIALIZER;
static void *python_library;
static char initialization_failure[1024];

#define PY_FUNCTION(name) static __typeof__(&name) api_##name
PY_FUNCTION(PyConfig_InitIsolatedConfig);
PY_FUNCTION(PyConfig_SetBytesString);
PY_FUNCTION(Py_InitializeFromConfig);
PY_FUNCTION(PyConfig_Clear);
PY_FUNCTION(Py_IsInitialized);
PY_FUNCTION(PyEval_SaveThread);
PY_FUNCTION(PyGILState_Ensure);
PY_FUNCTION(PyGILState_Release);
PY_FUNCTION(PyRun_StringFlags);
PY_FUNCTION(PyDict_New);
PY_FUNCTION(PyDict_SetItemString);
PY_FUNCTION(PyDict_GetItemString);
PY_FUNCTION(PyEval_GetBuiltins);
PY_FUNCTION(PyUnicode_FromString);
PY_FUNCTION(PyLong_AsLong);
PY_FUNCTION(Py_DecRef);
PY_FUNCTION(PyErr_Clear);

static int load_python(const char *library, const char *home, const char *site,
                       char *error, size_t capacity) {
    if (python_library) return 0;
    if (initialization_failure[0]) { snprintf(error, capacity, "%s", initialization_failure); return -1; }
    void *handle = dlopen(library, RTLD_NOW | RTLD_GLOBAL);
    if (!handle) { snprintf(error, capacity, "Could not load bundled Python: %.800s", dlerror()); return -1; }
#define LOAD(name) do { \
    api_##name = (__typeof__(&name))dlsym(handle, #name); \
    if (!api_##name) { snprintf(error, capacity, "Bundled Python is missing %s", #name); dlclose(handle); return -1; } \
} while (0)
    LOAD(PyConfig_InitIsolatedConfig); LOAD(PyConfig_SetBytesString);
    LOAD(Py_InitializeFromConfig); LOAD(PyConfig_Clear); LOAD(Py_IsInitialized); LOAD(PyEval_SaveThread);
    LOAD(PyGILState_Ensure); LOAD(PyGILState_Release); LOAD(PyRun_StringFlags);
    LOAD(PyDict_New); LOAD(PyDict_SetItemString); LOAD(PyDict_GetItemString);
    LOAD(PyEval_GetBuiltins); LOAD(PyUnicode_FromString); LOAD(PyLong_AsLong);
    LOAD(Py_DecRef); LOAD(PyErr_Clear);
#undef LOAD
    if (api_Py_IsInitialized()) {
        snprintf(error, capacity, "A different Python interpreter is already active in this preview process");
        dlclose(handle);
        return -1;
    }
    PyConfig config;
    api_PyConfig_InitIsolatedConfig(&config);
    config.install_signal_handlers = 0;
    config.write_bytecode = 0;
    config.parse_argv = 0;
    PyStatus status = api_PyConfig_SetBytesString(&config, &config.home, home);
    if (!status._type) status = api_PyConfig_SetBytesString(&config, &config.pythonpath_env, site);
    if (!status._type) status = api_Py_InitializeFromConfig(&config);
    if (status._type) snprintf(error, capacity, "Bundled Python initialization failed: %.800s", status.err_msg ? status.err_msg : "unknown error");
    api_PyConfig_Clear(&config);
    if (status._type) {
        // CPython may retain partial state after initialization fails. Never
        // unload its code or retry initialization in the same preview process.
        snprintf(initialization_failure, sizeof(initialization_failure), "%s", error);
        return -1;
    }
    python_library = handle; /* Python modules retain this library for process life. */
    api_PyEval_SaveThread();
    return 0;
}

static const char render_script[] =
    "import contextlib, json, os, runpy, sys, time, traceback\n"
    "_saved_argv, _saved_trace, _saved_path = sys.argv, sys.gettrace(), sys.path[:]\n"
    "_saved_rdbase = os.environ.get('RDBASE')\n"
    "_status = 1\n"
    "class _BoundedLog:\n"
    "    def __init__(self, path):\n"
    "        self.file = open(path, 'w', encoding='utf-8')\n"
    "        self.remaining = 65536\n"
    "    def write(self, text):\n"
    "        value = str(text).encode('utf-8')[:self.remaining].decode('utf-8', errors='ignore')\n"
    "        self.file.write(value)\n"
    "        self.remaining -= len(value.encode('utf-8'))\n"
    "        return len(text)\n"
    "    def flush(self): self.file.flush()\n"
    "_log = _BoundedLog(_log_path)\n"
    "_deadline = time.monotonic() + 25\n"
    "def _trace(frame, event, arg):\n"
    "    if time.monotonic() > _deadline: raise TimeoutError('CJSON rendering exceeded 25 seconds')\n"
    "    return _trace\n"
    "try:\n"
    "    sys.path.insert(0, _site_packages)\n"
    "    sys.argv = ['xyzrender'] + json.loads(_arguments_json)\n"
    "    with contextlib.redirect_stdout(_log), contextlib.redirect_stderr(_log):\n"
    "        try:\n"
    "            sys.settrace(_trace)\n"
    "            runpy.run_module('xyzrender.cli', run_name='__main__')\n"
    "            _status = 0\n"
    "        except SystemExit as error:\n"
    "            _status = error.code if isinstance(error.code, int) else (0 if error.code is None else 1)\n"
    "        except BaseException:\n"
    "            sys.settrace(None)\n"
    "            traceback.print_exc()\n"
    "finally:\n"
    "    sys.settrace(_saved_trace)\n"
    "    sys.argv = _saved_argv\n"
    "    sys.path[:] = _saved_path\n"
    "    # RDKit's RDConfig sets this during its first import. Scope that change.\n"
    "    if _saved_rdbase is None: os.environ.pop('RDBASE', None)\n"
    "    else: os.environ['RDBASE'] = _saved_rdbase\n"
    "    _log.file.close()\n";

__attribute__((visibility("default")))
int burette_xyzrender_run(const char *library, const char *home, const char *site,
                         const char *arguments_json, const char *log_path,
                         char *error, size_t capacity) {
    pthread_mutex_lock(&render_lock);
    if (load_python(library, home, site, error, capacity)) { pthread_mutex_unlock(&render_lock); return -1; }
    PyGILState_STATE gil = api_PyGILState_Ensure();
    PyObject *globals = api_PyDict_New();
    PyObject *arguments = api_PyUnicode_FromString(arguments_json);
    PyObject *log = api_PyUnicode_FromString(log_path);
    PyObject *site_path = api_PyUnicode_FromString(site);
    int status = -1;
    if (globals && arguments && log && site_path &&
        api_PyDict_SetItemString(globals, "__builtins__", api_PyEval_GetBuiltins()) == 0 &&
        api_PyDict_SetItemString(globals, "_arguments_json", arguments) == 0 &&
        api_PyDict_SetItemString(globals, "_site_packages", site_path) == 0 &&
        api_PyDict_SetItemString(globals, "_log_path", log) == 0) {
        PyObject *result = api_PyRun_StringFlags(render_script, Py_file_input, globals, globals, NULL);
        if (result) {
            PyObject *value = api_PyDict_GetItemString(globals, "_status");
            if (value) status = (int)api_PyLong_AsLong(value);
            api_Py_DecRef(result);
        }
    }
    if (status < 0) {
        snprintf(error, capacity, "Embedded CJSON renderer failed; inspect its bounded render log");
        api_PyErr_Clear();
    }
    if (arguments) api_Py_DecRef(arguments);
    if (log) api_Py_DecRef(log);
    if (site_path) api_Py_DecRef(site_path);
    if (globals) api_Py_DecRef(globals);
    api_PyGILState_Release(gil);
    pthread_mutex_unlock(&render_lock);
    return status;
}
