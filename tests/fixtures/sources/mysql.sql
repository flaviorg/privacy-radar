-- A MySQL dump: not supported in v0.1.
CREATE TABLE `patients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cpf` varchar(14) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3;

CREATE TABLE notes (body text);
