idf_component_register(
    SRCS "espidf/main/main.cpp" "espidf/main/model_json.cpp" "espidf/main/transport.cpp"
         "espidf/main/radio.cpp"
    INCLUDE_DIRS "espidf/main" "rc_limiter"
    REQUIRES driver esp_timer esp_system nvs_flash bt json)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
