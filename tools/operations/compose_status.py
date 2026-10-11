"""Read a Compose deployment's actual container images without exposing its environment."""

import argparse
import inspect
import json
import subprocess
import sys


class InspectionError(RuntimeError):
    """An inspection failed and must not be reported as an empty deployment."""


def docker_output(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise InspectionError(result.stderr.strip() or f"Docker exited with {result.returncode}")
    return result.stdout


def inspect_project(project, docker):
    identifiers = docker_output(docker + ["ps", "-a", "--filter", f"label=com.docker.compose.project={project}", "--format", "{{.ID}}"])
    identifiers = identifiers.split()
    if not identifiers:
        raise InspectionError(f"No containers found for Compose project {project!r}")
    containers = json.loads(docker_output(docker + ["inspect", *identifiers]))
    result = []
    for container in containers:
        config = container["Config"]
        labels = config.get("Labels") or {}
        if labels.get("com.docker.compose.project") != project:
            raise InspectionError("Container project changed during inspection")
        state = container["State"]
        result.append({
            "service": labels.get("com.docker.compose.service"),
            "name": container["Name"].lstrip("/"),
            "configured_image": config["Image"],
            "image_id": container["Image"],
            "status": state["Status"],
            "exit_code": state.get("ExitCode"),
            "health": (state.get("Health") or {}).get("Status"),
        })
    return {"project": project, "containers": sorted(result, key=lambda item: item["name"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", help="Exact Compose project label")
    parser.add_argument("--host", help="SSH destination, such as ubuntu@host")
    parser.add_argument("--identity", help="Existing SSH private-key path")
    parser.add_argument("--sudo", action="store_true", help="Use the host's existing sudo authorization; never change socket permissions")
    args = parser.parse_args()
    docker = ["sudo", "-n", "docker"] if args.sudo else ["docker"]
    try:
        if args.identity and not args.host:
            parser.error("--identity requires --host")
        if args.host:
            program = "import json, subprocess, sys\n"
            program += "\n\n".join(inspect.getsource(value) for value in [InspectionError, docker_output, inspect_project])
            program += f"\ntry:\n print(json.dumps(inspect_project({args.project!r}, {docker!r})))\n"
            program += "except (InspectionError, ValueError, KeyError, subprocess.SubprocessError) as error:\n print(str(error), file=sys.stderr)\n sys.exit(1)\n"
            command = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes"]
            if args.identity:
                command += ["-i", args.identity]
            command += ["--", args.host, "python3", "-"]
            result = subprocess.run(command, input=program, capture_output=True, text=True, timeout=75)
            if result.returncode:
                raise InspectionError(result.stderr.strip() or f"SSH inspection exited with {result.returncode}")
            report = json.loads(result.stdout)
        else:
            report = inspect_project(args.project, docker)
        print(json.dumps(report, indent=2))
        return 0
    except (InspectionError, ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
