export type APIPayload = {
  url: string;
  body: string;
  requestType: "POST" | "GET";
};

export type ValidateX402OPayload = {
  api: APIPayload;
  validationFunction: string;
};
