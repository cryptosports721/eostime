import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";


@Entity("applicationSettings",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("key_UNIQUE",["key",],{unique:true})
export class applicationSettings extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("varchar",{ 
        nullable:false,
        unique: true,
        length:45,
        name:"key"
        })
    key:string;
        

    @Column("mediumtext",{ 
        nullable:true,
        name:"value"
        })
    value:string | null;
        
}
