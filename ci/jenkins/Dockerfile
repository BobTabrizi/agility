# Jenkins, an alternative to GitHub Actions for running the Jenkinsfile: the LTS
# image plus the Docker CLI, so pipelines can run their steps in containers,
# and the plugins the Jenkinsfile uses.
FROM jenkins/jenkins:lts-jdk21

USER root
# Only the client binaries — the containers run on Docker Desktop's engine,
# reached through the mounted socket (see docker-compose.yml).
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin /buildx /usr/libexec/docker/cli-plugins/docker-buildx

USER jenkins
# workflow-aggregator: Pipeline itself. docker-workflow: `agent { docker ... }`
# and docker.image(...). pipeline-graph-view: the stage-by-stage build view.
# ws-cleanup: cleanWs(), which empties the workspace after each build.
RUN jenkins-plugin-cli --plugins workflow-aggregator git docker-workflow pipeline-graph-view ws-cleanup
