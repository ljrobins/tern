import os

text = "make america great again"

os.system(
    f"echo '{text}' | piper --model speech-models/en_US-amy-medium.onnx --output_file welcome.wav"
)
