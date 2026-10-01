// Creates the app's tables in DynamoDB Local (docker-compose.yml), so the
// DynamoDB store can run and be tested with no AWS account involved. Reads the
// same settings as the app; the endpoint comes from AWS_ENDPOINT_URL_DYNAMODB,
// which the AWS SDK picks up on its own. Safe to re-run: existing tables are
// left alone. Refuses to run without an endpoint, so it never creates tables
// in a real AWS account.
import { CreateTableCommand, DynamoDBClient, ResourceInUseException } from "@aws-sdk/client-dynamodb";

if (!process.env.AWS_ENDPOINT_URL_DYNAMODB) {
  console.error("AWS_ENDPOINT_URL_DYNAMODB isn't set — this script is only for DynamoDB Local.");
  process.exit(1);
}

const tables = [process.env.DYNAMODB_TABLE_NAME, process.env.DYNAMODB_TEST_TABLE].filter(Boolean);
const client = new DynamoDBClient({});

for (const TableName of tables) {
  // DynamoDB Local can take a few seconds to accept connections after its
  // container starts.
  for (let attempt = 1; ; attempt++) {
    try {
      await client.send(
        new CreateTableCommand({
          TableName,
          BillingMode: "PAY_PER_REQUEST",
          AttributeDefinitions: [
            { AttributeName: "pk", AttributeType: "S" },
            { AttributeName: "sk", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "pk", KeyType: "HASH" },
            { AttributeName: "sk", KeyType: "RANGE" },
          ],
        })
      );
      console.log(`Created table ${TableName}`);
      break;
    } catch (err) {
      if (err instanceof ResourceInUseException) {
        console.log(`Table ${TableName} already exists`);
        break;
      }
      if (attempt >= 20) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
