// The same checks as .github/workflows/ci.yml, for Jenkins as an alternative
// to GitHub Actions (a ready-to-run Jenkins is in ci/jenkins/). Every step
// runs in a throwaway container started on Docker Desktop, so the Jenkins
// machine itself only needs the Docker CLI.
pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
    timeout(time: 20, unit: 'MINUTES')
  }

  environment {
    NEXT_TELEMETRY_DISABLED = '1'
  }

  stages {
    // One Node container for all of these; reuseNode keeps it on the same
    // workspace as the rest of the pipeline, so later stages see node_modules.
    stage('Checks') {
      agent {
        docker {
          image 'node:24-alpine'
          reuseNode true
        }
      }
      stages {
        stage('Install') {
          steps { sh 'npm ci' }
        }
        stage('Lint') {
          steps { sh 'npm run lint' }
        }
        stage('Type-check') {
          steps { sh 'npm run typecheck' }
        }
        stage('Unit tests') {
          steps { sh 'npm test' }
        }
        stage('Build') {
          steps { sh 'npm run build' }
        }
      }
    }

    // DynamoDB Local in its own container for the length of this stage. The
    // Node container joins its network, so DynamoDB Local is at localhost:8000
    // — what `test:dynamo:local` expects.
    stage('DynamoDB tests') {
      steps {
        script {
          docker.image('amazon/dynamodb-local').withRun { db ->
            docker.image('node:24-alpine').inside("--network container:${db.id}") {
              sh 'npm run test:dynamo:local'
            }
          }
        }
      }
    }

    // Builds the production image to prove it still builds; one tag, replaced
    // by each build, so images don't pile up.
    stage('Docker image') {
      steps { sh 'docker build -t agility:jenkins .' }
    }
  }

  post {
    // Delete the workspace after every build, pass or fail. Keeping it saves
    // nothing (npm ci reinstalls node_modules from scratch anyway) and costs
    // ~700 MB per job — per branch and PR in a multibranch job.
    always {
      cleanWs(notFailBuild: true)
    }
  }
}
