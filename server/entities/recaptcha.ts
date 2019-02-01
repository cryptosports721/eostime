import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";


@Entity("recaptcha",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("tokenHash_UNIQUE",["tokenHash",],{unique:true})
@Index("auctionId_idx",["auctionId",])
@Index("accountName_idx",["accountName",])
@Index("creationDatetime_idx",["creationDatetime",])
export class recaptcha extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("datetime",{ 
        nullable:false,
        name:"creationDatetime"
        })
    creationDatetime:Date;
        

    @Column("varchar",{ 
        nullable:false,
        length:12,
        name:"accountName"
        })
    accountName:string;
        

    @Column("varchar",{ 
        nullable:false,
        unique: true,
        length:45,
        name:"tokenHash"
        })
    tokenHash:string;
        

    @Column("int",{ 
        nullable:true,
        name:"auctionId"
        })
    auctionId:number | null;
        
}
