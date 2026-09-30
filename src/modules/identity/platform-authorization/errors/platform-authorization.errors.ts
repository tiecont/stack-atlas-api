export class PlatformAuthorizationInputError extends Error {
  constructor() {
    super('Platform authorization input is invalid.');
    this.name = 'PlatformAuthorizationInputError';
  }
}

export class PlatformAuthorizationAccountNotFoundError extends Error {
  constructor() {
    super('The target account does not exist.');
    this.name = 'PlatformAuthorizationAccountNotFoundError';
  }
}

export class PlatformAuthorizationRoleNotFoundError extends Error {
  constructor() {
    super('The platform role does not exist in the database.');
    this.name = 'PlatformAuthorizationRoleNotFoundError';
  }
}
