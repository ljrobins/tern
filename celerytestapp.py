import os
from flask import Flask, request, jsonify
from flask_socketio import SocketIO
from celery import Celery, Task, shared_task
from celery.result import AsyncResult

# Directory to save audio files
AUDIO_DIR = "speech-samples"
os.makedirs(AUDIO_DIR, exist_ok=True)


def celery_init_app(flask_app: Flask) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object) -> object:
            with flask_app.app_context():
                return self.run(*args, **kwargs)

    celery_app = Celery(flask_app.name, task_cls=FlaskTask)
    celery_app.config_from_object(flask_app.config["CELERY"])
    celery_app.set_default()
    flask_app.extensions["celery"] = celery_app
    return celery_app


def generate_garbled_string(length: int = 10) -> str:
    """Generate a random garbled string of specified length."""
    return " ".join(length * ["bread"])


@shared_task(ignore_result=False)
def long_running_task(length: int) -> list[str]:
    """Run a command with random garbled strings."""
    generated_files = []
    text = generate_garbled_string(length=length)
    filename = f"{text.split(' ')[0]}{length}.wav"
    filepath = os.path.join(AUDIO_DIR, filename)  # Save to /tmp directory
    os.system(
        f"echo '{text}' | piper --model speech-models/en_US-amy-medium.onnx --output_file {filepath}"
    )
    generated_files.append(filepath)
    return generated_files


def create_app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.config.from_mapping(
        CELERY=dict(
            broker_url="redis://localhost",
            result_backend="redis://localhost",
            task_ignore_result=True,
            broker_connection_retry_on_startup=False,
        ),
    )
    flask_app.config.from_prefixed_env()
    celery = celery_init_app(flask_app)
    return flask_app, celery


flask_app, celery = create_app()
socketio = SocketIO(flask_app)


@flask_app.post("/trigger_task")
def start_task() -> dict[str, object]:
    length = request.args.get("length", default=1, type=int)
    result = long_running_task.delay(length)
    return {"result_id": result.id}


@flask_app.get("/get_result")
def task_result() -> dict[str, object]:
    result_id = request.args.get("result_id")
    result = AsyncResult(result_id)
    if result.ready():
        if result.successful():
            return {
                "ready": result.ready(),
                "successful": result.successful(),
                "generated_files": result.result,
            }
        else:
            return jsonify({"status": "ERROR", "error_message": str(result.result)})
    else:
        return jsonify({"status": "Running"})


if __name__ == "__main__":
    context = ("cert/server.crt", "cert/server.key")  # certificate and key files
    socketio.run(flask_app, host="0.0.0.0", debug=True, ssl_context=context)
