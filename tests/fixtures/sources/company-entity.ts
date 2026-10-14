/** A supplier company: names and addresses here belong to an organisation, not a person. */
export interface Company {
  cnpj: string;
  name: string;
  address: string;
  createdAt: Date;
}
