import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";


@Entity("auctionType",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("typeId_idx",["typeId",])
export class auctionType extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("int",{ 
        nullable:false,
        name:"typeId"
        })
    typeId:number;
        

    @Column("varchar",{ 
        nullable:true,
        length:45,
        name:"color"
        })
    color:string | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:45,
        name:"icon"
        })
    icon:string | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:45,
        name:"text"
        })
    text:string | null;
        

    @Column("int",{ 
        nullable:true,
        name:"nextTypeId"
        })
    nextTypeId:number | null;
        

    @Column("blob",{ 
        nullable:true,
        name:"blockchainParams"
        })
    blockchainParams:Buffer | null;
        
}
