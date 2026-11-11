# Cloudflare scanner model

The Cloudflare scanner uses TinyLlama-1.1B-Chat-v1.0, quantized by TheBloke to
Q4_K_M GGUF and executed with llama-cpp-python 0.3.16. The original pinned
llama3-small model produced unrelated text during actual inference and was not
accepted for this deployment. The server's original model defaults remain
unchanged outside the Cloudflare image.

- Base model: https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0
- Quantization: https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF
- Artifact: `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` (668,788,096 bytes).
- SHA-256: `9fecc3b3cd76bba89d504f29b616eedf7da85b96540e490ca5824d3f7d2776a0`.
- License: Apache-2.0; see MODEL-LICENSE.txt.

This is a model-based classification of supplied observations. A working model
invocation does not validate driving-safety accuracy, observe remote hazards,
or provide a weather forecast. Radar imagery is shown separately with its time.
