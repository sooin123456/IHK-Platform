cmake_minimum_required(VERSION 3.25)
project(onehk_ifcplusplus_derivative LANGUAGES C CXX)

if(NOT DEFINED IFCPP_SOURCE_DIR)
  message(FATAL_ERROR "IFCPP_SOURCE_DIR must point to pinned, patched IfcPlusPlus source")
endif()

set(BUILD_CONSOLE_APPLICATION OFF CACHE BOOL "" FORCE)
set(BUILD_VIEWER_APPLICATION OFF CACHE BOOL "" FORCE)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
add_subdirectory("${IFCPP_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/ifcplusplus")

add_executable(ifcplusplus-derivative src/main.cpp)
target_compile_features(ifcplusplus-derivative PRIVATE cxx_std_17)
target_link_libraries(ifcplusplus-derivative PRIVATE IfcPlusPlus)
target_include_directories(ifcplusplus-derivative PRIVATE
  "${IFCPP_SOURCE_DIR}/IfcPlusPlus/src"
  "${IFCPP_SOURCE_DIR}/IfcPlusPlus/src/ifcpp/IFC4X3/include"
  "${IFCPP_SOURCE_DIR}/IfcPlusPlus/src/external"
  "${IFCPP_SOURCE_DIR}/IfcPlusPlus/src/external/Carve/include"
)
