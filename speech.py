import os

text = '{ "text": "test one.", "output_file": "speech-samples/welcome1.wav" }\n{ "text": "test two.", "output_file": "speech-samples/welcome2.wav"}'

os.system(
    f"echo '{text}' | piper/install/piper --json-input --model speech-models/en_US-amy-low.onnx"
)
