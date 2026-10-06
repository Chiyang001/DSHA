cmake_minimum_required(VERSION 3.22.1)
project(dsh_android)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION
    ${CMAKE_CURRENT_LIST_DIR}/src/main/jniLibs/${ANDROID_ABI}/libnode.so)
add_library(dshbridge SHARED src/main/cpp/dshbridge.cpp)
target_include_directories(dshbridge PRIVATE libnode/include/node)
target_link_libraries(dshbridge node log)
add_library(dshflock SHARED src/main/cpp/flock.cpp)
target_include_directories(dshflock PRIVATE libnode/include/node)
target_link_libraries(dshflock node)

# Build node-pty against Android's bionic instead of shipping a glibc prebuild.
add_library(dshpty SHARED ../runtime/node_modules/node-pty/src/unix/pty.cc)
target_include_directories(dshpty PRIVATE libnode/include/node ../runtime/node_modules/node-addon-api)
target_compile_definitions(dshpty PRIVATE NODE_GYP_MODULE_NAME=dshpty NAPI_CPP_EXCEPTIONS)
target_compile_options(dshpty PRIVATE -fexceptions)
target_link_libraries(dshpty node)
