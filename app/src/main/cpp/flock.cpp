#include <node_api.h>
#include <sys/file.h>
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <string>

static napi_value publishNew(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string paths[2];
    for (size_t i = 0; i < 2; i++) {
        size_t length = 0;
        if (argc != 2 || napi_get_value_string_utf8(env, args[i], nullptr, 0, &length) != napi_ok || length > 4096) {
            napi_throw_type_error(env, nullptr, "Expected two filesystem paths");
            return nullptr;
        }
        paths[i].resize(length + 1);
        napi_get_value_string_utf8(env, args[i], paths[i].data(), length + 1, &length);
        if (paths[i].find('\0') != length) {
            napi_throw_type_error(env, nullptr, "Path contains NUL");
            return nullptr;
        }
    }
    // RENAME_NOREPLACE atomically publishes a complete temp without overwriting
    // an existing target. Android SELinux forbids app-created hard links.
    int result;
    do { result = syscall(SYS_renameat2, AT_FDCWD, paths[0].c_str(), AT_FDCWD, paths[1].c_str(), 1); }
    while (result < 0 && errno == EINTR);
    int error = result == 0 ? 0 : errno;
    napi_value value;
    napi_create_int32(env, error, &value);
    return value;
}

// Nonblocking kernel lock; the caller owns and closes the descriptor.
static napi_value tryLock(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    int32_t fd;
    if (argc != 1 || napi_get_value_int32(env, args[0], &fd) != napi_ok || fd < 0) {
        napi_throw_type_error(env, nullptr, "Expected an open file descriptor");
        return nullptr;
    }
    int result;
    do { result = flock(fd, LOCK_EX | LOCK_NB); } while (result < 0 && errno == EINTR);
    int error = result == 0 ? 0 : errno;
    napi_value value;
    napi_create_int32(env, error, &value);
    return value;
}
NAPI_MODULE_INIT() {
    napi_value fn;
    napi_create_function(env, "tryLock", NAPI_AUTO_LENGTH, tryLock, nullptr, &fn);
    napi_set_named_property(env, exports, "tryLock", fn);
    napi_create_function(env, "publishNew", NAPI_AUTO_LENGTH, publishNew, nullptr, &fn);
    napi_set_named_property(env, exports, "publishNew", fn);
    return exports;
}
